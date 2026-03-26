import { getEventBus } from "../events/eventbus.factory.js";
import { getLogger } from "../logger/logger.factory.js";

/**
 * @description Decorador de método para suscribirse a eventos emitidos en el EventBus.
 * El método decorado se ejecutará cada vez que se emita un evento con el nombre especificado.
 * @param eventName El nombre del evento al que se desea suscribir el método decorado.
 * Este nombre debe coincidir con el utilizado al emitir el evento en el EventBus.
 * @example
 * class EmailService {
 *   \@OnEvent("user.created")
 *   async sendWelcomeEmail(user: { name: string; email: string }) {
 *     // Lógica para enviar un correo de bienvenida al nuevo usuario
 *     console.log(`Enviando correo de bienvenida a ${user.email}`);
 *   }
 * }
 * @returns Una función que envuelve el método original, registrándolo como un listener para el evento especificado en el EventBus.
 */
export function OnEvent(eventName: string) {
  return function <This, Args extends any[], Return>(
    target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >,
  ) {
    if (context.kind !== "method") {
      throw new Error("@OnEvent solo puede ser aplicado a métodos de clase.");
    }

    // addInitializer se ejecuta cuando el contenedor DI crea la instancia (ej. new EmailService())
    context.addInitializer(function (this: This) {
      const eventBus = getEventBus();
      const logger = getLogger();

      eventBus.on(eventName, async (payload?: any) => {
        try {
          // Convertimos el payload en un array de argumentos para pasarlo al método decorado
          const argsToPass = (payload === undefined
            ? []
            : [payload]) as unknown as Args;

          // Llamamos al método decorado con el contexto de la instancia y los argumentos del payload
          const result = target.apply(this, argsToPass);

          if (result instanceof Promise) {
            await result;
          }
        } catch (err) {
          logger.error(
            `💥 [EventBus] Error procesando evento '${eventName}' en método '${String(context.name)}'`,
            {
              error: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
            },
          );
        }
      });
    });

    return target;
  };
}
