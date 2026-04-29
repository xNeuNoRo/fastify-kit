import os from "node:os";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { ConfigRegistry } from "../../config/ConfigRegistry.js";
import { QueueOptions } from "../../core/interfaces/queue.interface.js";
import { WorkerIncomingJob, WorkerOutgoingMessage } from "./worker-protocol.js";
import { getLogger } from "../../logger/logger.factory.js";
import { QueueType } from "../interfaces/queue-options.js";
import { QueueRegistry } from "../QueueRegistry.js";
import { Injectable } from "../../container/injectable.decorator.js";

export interface JobTask<TResult = unknown> {
  jobId: string;
  queueName: string;
  payload: unknown;
  resolve: (value: TResult | PromiseLike<TResult>) => void;
  reject: (reason?: Error) => void;
}

interface WorkerNode {
  instance: Worker;
  activeJobs: number;
  elu: number; // Expected Latency Until available (en milisegundos)
}

@Injectable()
export class WorkerPool {
  private workers: WorkerNode[] = [];

  private readonly taskQueues = new Map<string, JobTask[]>();
  private readonly activeTasks = new Map<string, JobTask>();

  private readonly workerScript: URL;

  private readonly poolSize: number;
  private readonly maxIoConcurrency: number;
  private readonly cpuEluThreshold: number;

  private readonly logger = getLogger();

  constructor() {
    // Cargamos configuración global para el pool de workers
    const config = ConfigRegistry.get<QueueOptions>("queue_user_config") || {};

    // Aplicamos valores por defecto si no se proporcionan en la configuración
    this.poolSize = config.poolSize ?? Math.max(1, os.cpus().length - 1);
    this.maxIoConcurrency = config.maxIoConcurrency ?? 50;
    this.cpuEluThreshold = config.eluThreshold ?? 0.85;

    // Creamos la URL del script del worker
    this.workerScript = new URL("./worker-executor.js", import.meta.url);

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
      activeJobs: 0,
      elu: 0,
    };

    // Configuramos el listener para mensajes del worker, para actualizar su ELU y manejar resultados de trabajos
    worker.on("message", (msg: WorkerOutgoingMessage) => {
      // Solo actualizamos el ELU del worker si recibimos un mensaje de tipo heartbeat
      if (msg.type === "heartbeat") {
        workerNode.elu = msg.elu;
        return;
      }
      // Si el mensaje es de tipo job_done, actualizamos el estado del worker
      // y resolvemos/rechazamos la promesa del trabajo correspondiente
      if (msg.type === "job_done") {
        // Decrementamos el contador de trabajos activos del worker, ya que acaba de terminar uno
        workerNode.activeJobs--;

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

      // Finalizamos el worker que colapso y lo removemos del pool
      worker.terminate();
      this.workers = this.workers.filter((w) => w.instance !== worker);

      // Creamos un nuevo worker para reemplazar al que colapso
      this.createWorker();
    });

    // Agregamos el nuevo worker al pool
    this.workers.push(workerNode);
  }

  /**
   * @description Selecciona el mejor worker disponible para procesar una tarea de un tipo de cola específico,
   * basándose en su ELU para colas CPU o en su número de trabajos activos para colas IO.
   * @param queueType El tipo de la cola para la cual se necesita un worker ("cpu" o "io")
   * @returns El nodo del worker seleccionado o null si no hay ninguno disponible que cumpla los criterios
   */
  private getBestWorkerFor(queueType: QueueType): WorkerNode | null {
    let bestWorker: WorkerNode | null = null;

    // Si la cola es de tipo CPU, buscamos el worker con el ELU más bajo,
    // siempre que esté por debajo del umbral configurado
    if (queueType === "cpu") {
      let minElu = this.cpuEluThreshold;
      for (const w of this.workers) {
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
      for (const w of this.workers) {
        if (w.activeJobs < minJobs) {
          bestWorker = w;
          minJobs = w.activeJobs;
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
    workerNode.activeJobs++;
    this.activeTasks.set(task.jobId, task);

    const message: WorkerIncomingJob = {
      jobId: task.jobId,
      queueName: task.queueName,
      payload: task.payload,
    };

    workerNode.instance.postMessage(message);
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
}
