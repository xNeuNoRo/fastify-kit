import { container } from "../../container/DIContainer.js";
import {
  CONFIG_SERVICE_TOKEN,
  type ConfigService,
} from "../../config/ConfigService.js";
import {
  QUEUE_REGISTRY_TOKEN,
  type QueueRegistryService,
} from "../QueueRegistryService.js";
import { Injectable } from "../../container/injectable.decorator.js";
import { BeforeApplicationShutdown } from "../../core/interfaces/lifecycle.interface.js";
import {
  WorkerLifecycleManager,
  type WorkerNode,
} from "./WorkerLifecycleManager.js";
import { TaskScheduler } from "./TaskScheduler.js";
import { JobTask } from "./JobTask.js";

/**
 * @description Pool de workers multihilo para procesamiento de Background Jobs.
 * Orquesta WorkerLifecycleManager (creación/destrucción de hilos) y
 * TaskScheduler (asignación de tareas), delegando cada responsabilidad
 * a servicios enfocados.
 *
 * Reemplaza la antigua clase monolítica de 428 líneas.
 */
@Injectable()
export class WorkerPool implements BeforeApplicationShutdown {
  private readonly workers: WorkerNode[] = [];
  private readonly taskQueues = new Map<string, JobTask[]>();
  private readonly activeTasks = new Map<string, JobTask>();

  private readonly lifecycle: WorkerLifecycleManager;
  private readonly scheduler: TaskScheduler;

  constructor() {
    // Cargamos configuración global para el pool de workers
    const configService = container.resolve<ConfigService>(CONFIG_SERVICE_TOKEN);
    const config = configService.get("queue") || {};

    this.lifecycle = new WorkerLifecycleManager(
      this.workers,
      this.taskQueues,
      this.activeTasks,
    );

    this.scheduler = new TaskScheduler(
      this.workers,
      this.taskQueues,
      this.activeTasks,
      {
        maxIoConcurrency: config.maxIoConcurrency ?? 50,
        cpuEluThreshold: config.eluThreshold ?? 0.85,
      },
    );

    // Conectamos el callback de procesamiento: cuando un worker
    // está listo o se libera, el scheduler procesa tareas pendientes
    this.lifecycle.onProcessNext = () => {
      this.scheduler.processNextFromQueue();
    };

    // Inicializamos el pool de workers
    this.lifecycle.initializePool();
  }

  /**
   * @description Método principal para ejecutar un trabajo en el pool de workers.
   * Delega al TaskScheduler la selección del worker óptimo y la asignación de la tarea.
   */
  public execute<TResult = unknown>(
    queueName: string,
    payload: unknown,
  ): Promise<TResult> {
    return this.scheduler.execute<TResult>(queueName, payload);
  }

  /**
   * @description Método del ciclo de vida que se ejecuta antes de que la aplicación se apague,
   * utilizado para cerrar el pool de workers de forma segura y evitar que queden procesos huérfanos.
   */
  public async beforeApplicationShutdown(_signal?: string): Promise<void> {
    await this.lifecycle.close();
  }
}
