import { container, Contract } from "../container/DIContainer";
import { getLogger } from "../logger/logger.factory";
import { DefaultEventBus, EVENT_BUS_TOKEN, EventBusContract } from "./EventBus";

let fallbackEventBus: EventBusContract | null = null;

/**
 * @description Factory para obtener una instancia del EventBus.
 * @example
 * ```typescript
 * // Obteniendo una instancia del EventBus
 * const eventBus = getEventBus();
 * eventBus.emit("user.registered", { userId: 123, username: "john_doe" });
 * ```
 * @returns Una instancia de EventBusContract, ya sea la registrada en el contenedor de dependencias
 * o una implementación por defecto si no se ha registrado ninguna.
 */
export function getEventBus(): EventBusContract {
  try {
    return container.resolve<EventBusContract>(
      EVENT_BUS_TOKEN as unknown as Contract<EventBusContract>,
    );
  } catch (error) {
    fallbackEventBus ??= new DefaultEventBus();
    getLogger().warn(
      "[FastifyKit EventBus] No se pudo resolver una instancia de EventBusContract desde el contenedor de dependencias. Se está utilizando el EventBus por defecto. Asegúrate de registrar una implementación de EventBusContract en el contenedor para obtener funcionalidades completas del bus de eventos.",
      { error: (error as Error).message },
    );
    return fallbackEventBus;
  }
}
