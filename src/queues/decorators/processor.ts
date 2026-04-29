import { FastifyKitMetadata } from "../../http/decorators/types.js";
import { QueueType } from "../interfaces/queue-options.js";

/**
 * @description Decorador para marcar una clase como procesadora de una cola específica.
 * @param name - El nombre de la cola que esta clase procesará.
 * @param type - El tipo de la cola, que puede ser "cpu" o "io".
 * Esto ayuda a optimizar el rendimiento y la asignación de recursos. Por defecto es "cpu".
 * (IO para tareas de red / CPU para tareas intensivas en cálculo)
 * @example
 * \@Processor("emailQueue") // Esta clase se encargará de procesar trabajos de la cola "emailQueue"
 * class EmailProcessor implements JobHandler<EmailPayload, void> {
 *   async handle(jobId: string, payload: EmailPayload): Promise<void> {
 *     // Lógica para enviar un correo electrónico utilizando los datos del payload
 *   }
 * }
 */
export function Processor(name: string, type: QueueType = "cpu") {
  return function <This, Args extends any[], Return>(
    target: (this: This, ...args: Args) => Return,
    context: ClassDecoratorContext,
  ) {
    if (context.kind !== "class") {
      throw new Error(
        "El decorador @Processor solo puede ser aplicado a clases",
      );
    }

    const metadata = context.metadata as FastifyKitMetadata;

    if (metadata.queue) {
      throw new Error(
        `La clase ${context.name} ya esta asignada a la cola ${metadata.queue.name}. No puedes asignar múltiples colas a la misma clase. Si necesitas manejar múltiples colas, considera crear clases separadas para cada una.`,
      );
    }

    metadata.queue = { name, type };
  };
}
