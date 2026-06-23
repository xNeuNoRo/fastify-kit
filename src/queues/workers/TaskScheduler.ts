import { randomUUID } from "node:crypto";
import { container } from "../../container/DIContainer.js";
import {
  QUEUE_REGISTRY_TOKEN,
  type QueueRegistryService,
} from "../QueueRegistryService.js";
import { QueueType } from "../interfaces/queue-options.js";
import type { WorkerNode } from "./WorkerLifecycleManager.js";
import { JobTask } from "./JobTask.js";
import {
  WorkerIncomingMessage,
} from "./worker-protocol.js";

/**
 * @description Planificador de tareas del pool de workers.
 * Maneja la lógica de selección del mejor worker (CPU/IO),
 * asignación de tareas a workers y gestión de colas de espera.
 *
 * No crea ni destruye workers (eso es responsabilidad de WorkerLifecycleManager).
 */
export class TaskScheduler {
  private readonly maxIoConcurrency: number;
  private readonly cpuEluThreshold: number;

  constructor(
    private readonly workers: WorkerNode[],
    private readonly taskQueues: Map<string, JobTask[]>,
    private readonly activeTasks: Map<string, JobTask>,
    config: {
      maxIoConcurrency: number;
      cpuEluThreshold: number;
    },
  ) {
    this.maxIoConcurrency = config.maxIoConcurrency;
    this.cpuEluThreshold = config.cpuEluThreshold;
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
   * @description Recorre las colas de tareas pendientes y asigna trabajos a los workers
   * disponibles según el tipo de cola y su estado actual, intentando procesar la mayor cantidad de
   * tareas posible sin sobrecargar a los workers.
   */
  processNextFromQueue(): void {
    for (const [queueName, queue] of this.taskQueues.entries()) {
      if (queue.length === 0) {
        this.taskQueues.delete(queueName);
        continue;
      }

      const queueType =
        container
          .resolve<QueueRegistryService>(QUEUE_REGISTRY_TOKEN)
          .getQueueType(queueName) || "cpu";
      let availableWorker = this.getBestWorkerFor(queueType);

      // Mientras haya un worker disponible y tareas en la cola, seguimos asignando trabajos
      while (availableWorker && queue.length > 0) {
        const nextTask = queue.shift();
        if (nextTask) {
          this.assignTaskToWorker(availableWorker, nextTask);
        }
        availableWorker = this.getBestWorkerFor(queueType);
      }

      // Si después de intentar asignar trabajos la cola quedó vacía,
      // la eliminamos del mapa de colas pendientes
      if (queue.length === 0) {
        this.taskQueues.delete(queueName);
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

      const queueType =
        container
          .resolve<QueueRegistryService>(QUEUE_REGISTRY_TOKEN)
          .getQueueType(queueName) || "cpu";
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
