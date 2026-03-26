import { getEventBus } from "../events/eventbus.factory.js";
import { getLogger } from "../logger/logger.factory.js";

/**
 * @description Decorador de método para suscribirse a un evento emitido en el EventBus, pero solo para la primera vez que se emite dicho evento. Después de que el evento se haya manejado una vez, el método decorado dejará de ser un listener para ese evento.
 * @param eventName El nombre del evento al que se desea suscribir el método decorado. Este nombre debe coincidir con el utilizado al emitir el evento en el EventBus.
 * @example
 * class NotificationService {
 *   \@OnceEvent("user.loggedIn")
 *   async sendLoginNotification(user: { name: string; email: string }) {
 *     // Lógica para enviar una notificación de inicio de sesión al usuario
 *     console.log(`Enviando notificación de inicio de sesión a ${user.email}`);
 *   }
 * }
 * @remarks A diferencia del decorador \@OnEvent, el método decorado con \@OnceEvent solo se ejecutará la primera vez que se emita el evento especificado. Si el mismo evento se emite nuevamente, el método decorado no se ejecutará, ya que habrá sido removido automáticamente como listener después de su primera ejecución exitosa.
 * @returns Una función que envuelve el método original, registrándolo como un listener para el evento especificado en el EventBus, pero solo para la primera vez que se emite dicho evento.
 */
export function OnceEvent(eventName: string) {
  return function <This, Args extends any[], Return>(
    target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >,
  ) {
    if (context.kind !== "method") {
      throw new Error("@OnceEvent solo se puede aplicar a métodos de clase");
    }

    // addInitializer se ejecuta cuando el contenedor DI crea la instancia (ej. new EmailService())
    context.addInitializer(function (this: This) {
      const eventBus = getEventBus();
      const logger = getLogger();

      eventBus.once(eventName, async (payload?: any) => {
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
            `💥 [EventBus] Error procesando evento ONCE '${eventName}' en método '${String(context.name)}'`,
            {
              error: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
            },
          );
        }
      });
    });
  };
}
