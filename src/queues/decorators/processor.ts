import { FastifyKitMetadata } from "../../http/decorators/types.js";

/**
 * @description Decorador para marcar una clase como procesadora de una cola específica.
 * @param queueName El nombre de la cola que esta clase debe procesar.
 * @example
 * \@Processor("emailQueue") // Esta clase se encargará de procesar trabajos de la cola "emailQueue"
 * class EmailProcessor implements JobHandler<EmailPayload, void> {
 *   async handle(jobId: string, payload: EmailPayload): Promise<void> {
 *     // Lógica para enviar un correo electrónico utilizando los datos del payload
 *   }
 * }
 */
export function Processor(queueName: string) {
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

    if (metadata.queueName) {
      throw new Error(
        `La clase ${context.name} ya esta asignada a la cola ${metadata.queueName}. No puedes asignar múltiples colas a la misma clase. Si necesitas manejar múltiples colas, considera crear clases separadas para cada una.`,
      );
    }

    metadata.queueName = queueName;
  };
}
