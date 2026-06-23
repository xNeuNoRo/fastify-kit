import {
  WorkerOutgoingMessage,
} from "./worker-protocol.js";
import type { WorkerNode } from "./WorkerLifecycleManager.js";
import { JobTask } from "./JobTask.js";

/**
 * @description Manejador del protocolo de mensajes de los workers.
 * Procesa todos los tipos de mensajes entrantes (init_done, init_error,
 * heartbeat, job_done) y delega las acciones a los callbacks proporcionados.
 *
 * Es stateless: no mantiene estado propio, solo enruta mensajes.
 */
export class WorkerProtocolHandler {
  handleMessage(
    msg: WorkerOutgoingMessage,
    workerNode: WorkerNode,
    context: {
      workers: WorkerNode[];
      activeTasks: Map<string, JobTask>;
      taskQueues: Map<string, JobTask[]>;
      onInitDone: () => void;
      onInitError: (error: string) => void;
      onDeadWorker: (reason: string) => void;
      /** Callback para intentar procesar tareas pendientes de la cola */
      onProcessNext: () => void;
    },
  ): void {
    // Si el mensaje es de tipo init_done, marcamos al worker como listo
    // para recibir trabajos y procesamos cualquier tarea que haya quedado en espera
    if (msg.type === "init_done") {
      context.onInitDone();
      // Intentar procesar lo que quedó en espera
      context.onProcessNext();
      return;
    }

    // Si el mensaje es de tipo init_error, registramos el error y no marcamos al worker como listo
    // De esta forma el pool no le asignará trabajos y esperará a que colapse para reemplazarlo por uno nuevo
    if (msg.type === "init_error") {
      context.onInitError(msg.error);
      return;
    }

    // Solo actualizamos el ELU del worker si recibimos un mensaje de tipo heartbeat
    if (msg.type === "heartbeat") {
      workerNode.elu = msg.elu;

      // Si el worker ya recuperó capacidad (bajó su ELU) y tenemos tareas en espera,
      // intentamos asignarlas inmediatamente sin esperar a que llegue un 'job_done'.
      if (context.taskQueues.size > 0) {
        context.onProcessNext();
      }
      return;
    }

    // Si el mensaje es de tipo job_done, actualizamos el estado del worker
    // y resolvemos/rechazamos la promesa del trabajo correspondiente
    if (msg.type === "job_done") {
      // Removemos el jobId de la lista de trabajos activos del worker
      workerNode.activeJobIds.delete(msg.jobId);

      // Buscamos la tarea activa correspondiente al jobId reportado por el worker
      const task = context.activeTasks.get(msg.jobId);

      if (task) {
        context.activeTasks.delete(msg.jobId);

        if (msg.status === "success") {
          task.resolve(msg.data);
        } else {
          task.reject(new Error(msg.error));
        }
      }

      context.onProcessNext();
    }
  }
}
