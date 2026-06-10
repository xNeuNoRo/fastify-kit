import { OnEvent } from "../../events/on-event.decorator.js";
import { QueueEvents } from "../interfaces/queue-events.js";

/**
 * @description Decorador de método para suscribirse al éxito de una tarea en una cola distribuida.
 * El método decorado recibirá un objeto de tipo `QueueJobEvent`.
 * @param queueName Nombre de la cola a escuchar (o '*' para todas).
 */
export function OnQueueSuccess(queueName: string) {
  return OnEvent(QueueEvents.done(queueName));
}
