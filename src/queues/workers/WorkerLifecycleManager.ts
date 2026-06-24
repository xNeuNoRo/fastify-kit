import os from "node:os";
import { Worker } from "node:worker_threads";
import {
  WorkerIncomingMessage,
  WorkerOutgoingMessage,
} from "./worker-protocol.js";
import { getLogger } from "../../logger/logger.factory.js";
import { container } from "../../container/DIContainer.js";
import {
  INTERNAL_CONFIG_SERVICE_TOKEN,
  type InternalConfigService,
} from "../../config/InternalConfigService.js";
import {
  QUEUE_REGISTRY_TOKEN,
  type QueueRegistryService,
} from "../QueueRegistryService.js";
import { WorkerProtocolHandler } from "./WorkerProtocolHandler.js";
import { WorkerEventHandler } from "./WorkerEventHandler.js";
import { JobTask } from "./JobTask.js";

/**
 * @description Nodo que representa un worker en el pool.
 */
export interface WorkerNode {
  instance: Worker;
  activeJobIds: Set<string>;
  elu: number; // Event Loop Utilization como fracción entre 0 y 1
  isReady?: boolean; // Indicador de si el worker ha terminado su fase de inicialización
}

/**
 * @description Gestor del ciclo de vida de los workers del pool.
 * Maneja la creación, reemplazo, cierre y monitoreo de salud de los hilos worker.
 * No maneja la lógica de scheduling (asignación de tareas), que está en TaskScheduler.
 */
export class WorkerLifecycleManager {
  private readonly logger = getLogger();

  private readonly poolSize: number;
  private readonly maxInitRetries = 5;
  private consecutiveInitFailures = 0;

  private readonly workerBootstraps: string[];
  private readonly workerScript: URL;

  private readonly protocolHandler: WorkerProtocolHandler;
  private readonly eventHandler: WorkerEventHandler;

  /** Callback para procesar tareas pendientes (inyectado por el facade) */
  public onProcessNext: () => void = () => {};

  constructor(
    public workers: WorkerNode[],
    public readonly taskQueues: Map<string, JobTask[]>,
    public readonly activeTasks: Map<string, JobTask>,
  ) {
    // Cargamos configuración global para el pool de workers
    const configService =
      container.resolve<InternalConfigService>(INTERNAL_CONFIG_SERVICE_TOKEN);
    const config = configService.get("queue") || {};

    // Aplicamos valores por defecto si no se proporcionan en la configuración
    this.poolSize = config.poolSize ?? Math.max(1, os.cpus().length - 1);

    // Obtenemos la lista de archivos de procesadores registrados
    // en el QueueRegistryService, que fueron detectados por el scanner del framework durante el auto-discovery
    // de esa forma los pasamos luego a los workers aislados para que sepan dónde encontrar las clases procesadoras de las colas
    const queueRegistryService =
      container.resolve<QueueRegistryService>(QUEUE_REGISTRY_TOKEN);
    this.workerBootstraps = queueRegistryService.getProcessorFiles();

    // Creamos la URL del script del worker dependiendo de si estamos en un
    // entorno de desarrollo (TypeScript) o producción (JavaScript)
    const extension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
    this.workerScript = new URL(
      `./worker-executor${extension}`,
      import.meta.url,
    );

    this.protocolHandler = new WorkerProtocolHandler();
    this.eventHandler = new WorkerEventHandler();
  }

  /**
   * @description Inicializa el pool de workers creando las instancias necesarias según la configuración.
   */
  initializePool(): void {
    // Creamos los workers según el tamaño del pool configurado
    for (let i = 0; i < this.poolSize; i++) {
      this.createWorker();
    }
  }

  /**
   * @description Crea una nueva instancia de Worker,
   * configura sus listeners para manejar mensajes y errores, y la agrega al pool.
   */
  createWorker(): void {
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
      this.protocolHandler.handleMessage(msg, workerNode, {
        workers: this.workers,
        activeTasks: this.activeTasks,
        taskQueues: this.taskQueues,
        onInitDone: () => {
          this.consecutiveInitFailures = 0;
          workerNode.isReady = true;
        },
        onInitError: (error: string) => {
          this.handleDeadWorker(
            workerNode,
            worker,
            `Fallo inicialización: ${error}`,
          );
        },
        onDeadWorker: (reason: string) => {
          this.handleDeadWorker(workerNode, worker, reason);
        },
        onProcessNext: this.onProcessNext,
      });
    });

    // Manejamos errores del worker para detectar colapsos y reemplazarlo
    worker.on("error", (err: Error) => {
      this.eventHandler.handleError(err, workerNode, worker, () => {
        this.handleDeadWorker(workerNode, worker, err.message);
      });
    });

    // Manejamos la salida inesperada del worker para detectar colapsos y reemplazarlo
    worker.on("exit", (code: number) => {
      this.eventHandler.handleExit(code, workerNode, worker, (reason) => {
        this.handleDeadWorker(workerNode, worker, reason);
      });
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
   * @description Maneja la limpieza de un worker que ha colapsado o salido inesperadamente,
   * rechazando las promesas de los trabajos que se quedaron a medias para evitar memory leaks.
   */
  handleDeadWorker(
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

    // Limpiamos el worker del pool (mutación in-place para que el facade vea los cambios)
    worker.terminate().catch(() => {}); // Ignoramos errores si ya está muerto
    const idx = this.workers.findIndex((w) => w.instance === worker);
    if (idx >= 0) this.workers.splice(idx, 1);

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
   * @description Aborta todas las tareas pendientes y activas en el pool,
   * utilizado cuando el pool entra en un estado irrecuperable (por ejemplo, todos los workers colapsando al iniciar).
   */
  abortAllTasks(error: Error): void {
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
  async close(): Promise<void> {
    this.logger.info(
      "[FastifyKit Background Jobs] Cerrando pool de workers...",
    );
    this.abortAllTasks(
      new Error("WorkerPool se está cerrando (Apagado de aplicación)"),
    );
    await Promise.allSettled(
      this.workers.map((node) => node.instance.terminate()),
    );
    this.workers.length = 0;
    this.logger.info(
      "[FastifyKit Background Jobs] Pool de workers cerrado correctamente.",
    );
  }
}
