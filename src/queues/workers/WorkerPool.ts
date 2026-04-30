import os from "node:os";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { ConfigRegistry } from "../../config/ConfigRegistry.js";
import { QueueOptions } from "../../core/interfaces/queue.interface.js";
import {
  WorkerIncomingMessage,
  WorkerOutgoingMessage,
} from "./worker-protocol.js";
import { getLogger } from "../../logger/logger.factory.js";
import { QueueType } from "../interfaces/queue-options.js";
import { QueueRegistry } from "../QueueRegistry.js";
import { Injectable } from "../../container/injectable.decorator.js";
import { BeforeApplicationShutdown } from "../../core/interfaces/lifecycle.interface.js";

export interface JobTask<TResult = unknown> {
  jobId: string;
  queueName: string;
  payload: unknown;
  resolve: (value: TResult | PromiseLike<TResult>) => void;
  reject: (reason?: Error) => void;
}

interface WorkerNode {
  instance: Worker;
  activeJobIds: Set<string>;
  elu: number; // Event Loop Utilization como fracción entre 0 y 1
  isReady?: boolean; // Indicador de si el worker ha terminado su fase de inicialización
}

@Injectable()
export class WorkerPool implements BeforeApplicationShutdown {
  private workers: WorkerNode[] = [];
  private readonly workerBootstraps: string[];

  private readonly taskQueues = new Map<string, JobTask[]>();
  private readonly activeTasks = new Map<string, JobTask>();

  private readonly workerScript: URL;

  private readonly poolSize: number;
  private readonly maxIoConcurrency: number;
  private readonly cpuEluThreshold: number;

  private consecutiveInitFailures = 0;
  private readonly maxInitRetries = 5;

  private readonly logger = getLogger();

  constructor() {
    // Cargamos configuración global para el pool de workers
    const config = ConfigRegistry.get<QueueOptions>("queue_user_config") || {};

    // Aplicamos valores por defecto si no se proporcionan en la configuración
    this.poolSize = config.poolSize ?? Math.max(1, os.cpus().length - 1);
    this.maxIoConcurrency = config.maxIoConcurrency ?? 50;
    this.cpuEluThreshold = config.eluThreshold ?? 0.85;

    // Obtenemos la lista de archivos de procesadores registrados
    // en el QueueRegistry, que fueron detectados por el scanner del framework durante el auto-discovery
    // de esa forma los pasamos luego a los workers aislados para que sepan dónde encontrar las clases procesadoras de las colas
    this.workerBootstraps = QueueRegistry.getProcessorFiles();

    // Creamos la URL del script del worker dependiendo de si estamos en un
    // entorno de desarrollo (TypeScript) o producción (JavaScript)
    const extension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
    this.workerScript = new URL(
      `./worker-executor${extension}`,
      import.meta.url,
    );

    // Inicializamos el pool de workers
    this.initializePool();
  }

  /**
   * @description Inicializa el pool de workers creando las instancias necesarias según la configuración.
   */
  private initializePool(): void {
    // Creamos los workers según el tamaño del pool configurado
    for (let i = 0; i < this.poolSize; i++) {
      this.createWorker();
    }
  }

  /**
   * @description Crea una nueva instancia de Worker,
   * configura sus listeners para manejar mensajes y errores, y la agrega al pool.
   */
  private createWorker(): void {
    // Creamos una nueva instancia de Worker y le configuramos el nodo del worker para el pool
    const worker = new Worker(this.workerScript);
    const workerNode: WorkerNode = {
      instance: worker,
      activeJobIds: new Set(),
      elu: 0,
      isReady: false,
    };

    // Configuramos el listener para mensajes del worker, para actualizar su ELU y manejar resultados de trabajos
    worker.on("message", (msg: WorkerOutgoingMessage) => {
      // Si el mensaje es de tipo init_done, marcamos al worker como listo
      // para recibir trabajos y procesamos cualquier tarea que haya quedado en espera
      if (msg.type === "init_done") {
        this.consecutiveInitFailures = 0;
        workerNode.isReady = true;
        this.processNextFromQueue(); // Intentar procesar lo que quedó en espera
        return;
      }

      // Si el mensaje es de tipo init_error, registramos el error y no marcamos al worker como listo
      // De esta forma el pool no le asignará trabajos y esperará a que colapse para reemplazarlo por uno nuevo
      if (msg.type === "init_error") {
        this.handleDeadWorker(
          workerNode,
          worker,
          `Fallo inicialización: ${msg.error}`,
        );
        return;
      }

      // Solo actualizamos el ELU del worker si recibimos un mensaje de tipo heartbeat
      if (msg.type === "heartbeat") {
        workerNode.elu = msg.elu;
        return;
      }
      // Si el mensaje es de tipo job_done, actualizamos el estado del worker
      // y resolvemos/rechazamos la promesa del trabajo correspondiente
      if (msg.type === "job_done") {
        // Removemos el jobId de la lista de trabajos activos del worker
        workerNode.activeJobIds.delete(msg.jobId);

        // Buscamos la tarea activa correspondiente al jobId reportado por el worker
        const task = this.activeTasks.get(msg.jobId);

        if (task) {
          this.activeTasks.delete(msg.jobId);

          if (msg.status === "success") {
            task.resolve(msg.data);
          } else {
            task.reject(new Error(msg.error));
          }
        }

        this.processNextFromQueue();
      }
    });

    // Manejamos errores del worker para detectar colapsos y reemplazarlo
    worker.on("error", (err: Error) => {
      this.logger.error(
        "[FastifyKit Background Jobs] El hilo de un worker ha colapsado",
        err,
      );
      this.handleDeadWorker(workerNode, worker, err.message);
    });

    // Manejamos la salida inesperada del worker para detectar colapsos y reemplazarlo
    worker.on("exit", (code: number) => {
      if (code !== 0) {
        this.logger.error(
          `[FastifyKit Background Jobs] Un worker se cerró inesperadamente con código ${code}`,
        );
        this.handleDeadWorker(workerNode, worker, `Exit code ${code}`);
      }
    });

    // Agregamos el nuevo worker al pool
    this.workers.push(workerNode);

    // Al crear el worker, le enviamos un mensaje con la fase de bootstrapping
    // para que cargue los archivos de procesadores necesarios antes de empezar a recibir trabajos
    const initMsg: WorkerIncomingMessage = {
      type: "init",
      bootstraps: this.workerBootstraps,
    };
    worker.postMessage(initMsg);
  }

  /**
   * @description Selecciona el mejor worker disponible para procesar una tarea de un tipo de cola específico,
   * basándose en su ELU para colas CPU o en su número de trabajos activos para colas IO.
   * @param queueType El tipo de la cola para la cual se necesita un worker ("cpu" o "io")
   * @returns El nodo del worker seleccionado o null si no hay ninguno disponible que cumpla los criterios
   */
  private getBestWorkerFor(queueType: QueueType): WorkerNode | null {
    let bestWorker: WorkerNode | null = null;

    // Filtramos los workers para quedarnos solo con los que han terminado su fase de inicialización
    const readyWorkers = this.workers.filter((w) => w.isReady);

    // Si la cola es de tipo CPU, buscamos el worker con el ELU más bajo,
    // siempre que esté por debajo del umbral configurado
    if (queueType === "cpu") {
      let minElu = this.cpuEluThreshold;
      for (const w of readyWorkers) {
        if (w.elu < minElu) {
          bestWorker = w;
          minElu = w.elu;
        }
      }
    }
    // Si la cola es de tipo IO, buscamos el worker con menos trabajos activos,
    // siempre que no haya superado la concurrencia máxima configurada
    else {
      let minJobs = this.maxIoConcurrency;
      for (const w of readyWorkers) {
        if (w.activeJobIds.size < minJobs) {
          bestWorker = w;
          minJobs = w.activeJobIds.size;
        }
      }
    }

    return bestWorker;
  }

  /**
   * @description Recorre las colas de tareas pendientes y asigna la siguiente
   * tarea al primer worker disponible que cumpla los criterios para el tipo de cola.
   */
  private processNextFromQueue(): void {
    for (const [queueName, queue] of this.taskQueues.entries()) {
      if (queue.length === 0) {
        this.taskQueues.delete(queueName);
        continue;
      }

      const queueType = QueueRegistry.getQueueType(queueName) || "cpu";
      const availableWorker = this.getBestWorkerFor(queueType);

      if (availableWorker) {
        const nextTask = queue.shift();
        if (nextTask) {
          this.assignTaskToWorker(availableWorker, nextTask);
        }
        return;
      }
    }
  }

  /**
   * @description Asigna una tarea a un worker específico, actualizando su estado
   * y enviándole el mensaje con los detalles del trabajo.
   * @param workerNode El nodo del worker al que se le asignará la tarea
   * @param task La tarea que se asignará al worker, con su payload y funciones de resolución/rechazo
   */
  private assignTaskToWorker(workerNode: WorkerNode, task: JobTask): void {
    workerNode.activeJobIds.add(task.jobId);
    this.activeTasks.set(task.jobId, task);

    const message: WorkerIncomingMessage = {
      type: "job",
      jobId: task.jobId,
      queueName: task.queueName,
      payload: task.payload,
    };

    workerNode.instance.postMessage(message);
  }

  /**
   * @description Maneja la limpieza de un worker que ha colapsado o salido inesperadamente,
   * rechazando las promesas de los trabajos que se quedaron a medias para evitar memory leaks.
   */
  private handleDeadWorker(
    workerNode: WorkerNode,
    worker: Worker,
    reason: string,
  ): void {
    // Si el worker que colapsó no está en nuestro pool, no hacemos nada
    if (!this.workers.some((w) => w.instance === worker)) {
      return;
    }

    this.logger.error(
      `[FastifyKit Background Jobs] Worker muerto. Razón: ${reason}`,
    );

    // Rechazamos todas las tareas que se quedaron atrapadas en este worker
    for (const jobId of workerNode.activeJobIds) {
      const task = this.activeTasks.get(jobId);
      if (task) {
        task.reject(
          new Error(`Worker colapsó inesperadamente. Razón: ${reason}`),
        );
        this.activeTasks.delete(jobId);
      }
    }

    // Limpiamos el estado de trabajos activos del worker,
    // ya que todos quedaron atrapados y fueron rechazados
    workerNode.activeJobIds.clear();

    // Limpiamos el worker del pool
    worker.terminate().catch(() => {}); // Ignoramos errores si ya está muerto
    this.workers = this.workers.filter((w) => w.instance !== worker);

    if (workerNode.isReady) {
      this.createWorker();
    } else {
      // Si el worker colapsó durante su fase de inicialización,
      // incrementamos el contador de fallos consecutivos
      this.consecutiveInitFailures++;
      if (this.consecutiveInitFailures >= this.maxInitRetries) {
        this.logger.error(
          `[FastifyKit Background Jobs] Límite de fallos de inicio alcanzado (${this.maxInitRetries}). Abortando tareas.`,
        );
        this.abortAllTasks(
          new Error("Workers colapsando continuamente al nacer."),
        );
      } else {
        this.logger.warn(
          `[FastifyKit Background Jobs] Reintentando creación en 5s (Intento ${this.consecutiveInitFailures}/${this.maxInitRetries})`,
        );
        setTimeout(() => this.createWorker(), 5000);
      }
    }
  }

  /**
   * @description Método principal para ejecutar un trabajo en el pool de workers.
   * Recibe el nombre de la cola y el payload del trabajo,
   * @param queueName El nombre de la cola a la que pertenece el trabajo,
   * utilizado para determinar el tipo de cola y asignar el worker adecuado
   * @param payload Los datos que se enviarán al worker para procesar el trabajo
   * @returns Una promesa que se resolverá con el resultado del trabajo o se rechazará con un error si el trabajo falla
   */
  public execute<TResult = unknown>(
    queueName: string,
    payload: unknown,
  ): Promise<TResult> {
    return new Promise((resolve, reject) => {
      const jobId = randomUUID();
      const task: JobTask<TResult> = {
        jobId,
        queueName,
        payload,
        resolve,
        reject,
      };

      const queueType = QueueRegistry.getQueueType(queueName) || "cpu";
      const bestWorker = this.getBestWorkerFor(queueType);

      if (bestWorker) {
        this.assignTaskToWorker(bestWorker, task as JobTask<unknown>);
      } else {
        if (!this.taskQueues.has(queueName)) {
          this.taskQueues.set(queueName, []);
        }
        this.taskQueues.get(queueName)!.push(task as JobTask<unknown>);
      }
    });
  }

  /**
   * @description Aborta todas las tareas pendientes y activas en el pool,
   * utilizado cuando el pool entra en un estado irrecuperable (por ejemplo, todos los workers colapsando al iniciar).
   */
  private abortAllTasks(error: Error): void {
    // Limpiamos tareas que ni siquiera llegaron a un worker
    for (const [, queue] of this.taskQueues.entries()) {
      for (const task of queue) task.reject(error);
    }
    this.taskQueues.clear();

    // Limpiamos tareas que estaban ejecutándose en hilos
    for (const [jobId, task] of this.activeTasks) {
      task.reject(error);
      this.activeTasks.delete(jobId);
    }
  }

  /**
   * @description Método para cerrar el pool de workers, terminando todas
   * las instancias de Worker y limpiando el estado del pool.
   */
  public async close(): Promise<void> {
    this.logger.info(
      "[FastifyKit Background Jobs] Cerrando pool de workers...",
    );
    this.abortAllTasks(
      new Error("WorkerPool se está cerrando (Apagado de aplicación)"),
    );
    await Promise.allSettled(
      this.workers.map((node) => node.instance.terminate()),
    );
    this.workers = [];
    this.logger.info(
      "[FastifyKit Background Jobs] Pool de workers cerrado correctamente.",
    );
  }

  /**
   * @description Método del ciclo de vida que se ejecuta antes de que la aplicación se apague,
   * utilizado para cerrar el pool de workers de forma segura y evitar que queden procesos huérfanos.
   * @param signal La señal que causó el apagado de la aplicación (por ejemplo, "SIGINT", "SIGTERM", etc.),
   * o undefined si el apagado fue iniciado manualmente.
   * @returns Una promesa que se resuelve cuando el pool de workers ha sido cerrado correctamente.
   */
  public async beforeApplicationShutdown(signal?: string): Promise<void> {
    await this.close();
  }
}
