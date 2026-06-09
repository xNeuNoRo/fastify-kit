import { EventEmitter } from "node:events";

export interface EmitOptions {
  /**
   * Destino del evento:
   * - "local": Solo se emite en la instancia actual (comportamiento por defecto).
   * - "global": Se emite en todas las instancias conectadas a Redis.
   * - "string (instanceId)": Se emite específicamente a la instancia con ese ID.
   */
  target?: "local" | "global" | (string & {});
}

// Interfaz que define el contrato para el EventBus
export interface EventBusContract {
  emit(eventName: string, payload?: any, options?: EmitOptions): void;
  on(eventName: string, listener: (payload: any) => void | Promise<void>): void;
  off(
    eventName: string,
    listener: (payload: any) => void | Promise<void>,
  ): void;
  once(
    eventName: string,
    listener: (payload: any) => void | Promise<void>,
  ): void;
}

// Token para identificar el EventBus en el contenedor de dependencias
export const EVENT_BUS_TOKEN = Symbol.for("EVENT_BUS_TOKEN");

export class DefaultEventBus implements EventBusContract {
  private readonly emitter = new EventEmitter().setMaxListeners(100);

  /**
   * @description Emite un evento con un nombre específico y un payload opcional. Los listeners registrados para ese evento serán ejecutados con el payload proporcionado. Todos los listeners se pueden subscribir con el decorador `@OnEvent` o `@OnceEvent` en sus respectivos métodos. El método `emit` es utilizado para disparar eventos desde cualquier parte de la aplicación, permitiendo una comunicación eficiente entre diferentes componentes sin acoplarlos directamente.
   * @param eventName El nombre del evento a emitir. Este es un string que identifica el tipo de evento que se está emitiendo.
   * @param payload Opcional. Cualquier dato que se desee pasar a los listeners del evento. Puede ser de cualquier tipo (objeto, string, número, etc.) y será recibido por los listeners registrados para ese evento.
   * @param options Opcional. Configuración adicional para la emisión del evento,
   * como el destino (local, global o dirigido a una instancia específica).
   * @example
   * ```typescript
   * // Emitiendo un evento de usuario registrado
   * eventBus.emit("user.registered", { userId: 123, username: "john_doe" });
   *
   * // Emitiendo un evento de orden creada
   * eventBus.emit("order.created", { orderId: 456, amount: 99.99 });
   *
   * // Emitiendo un evento global que será recibido por todas las instancias conectadas a Redis
   * eventBus.emit("system.maintenance", { scheduledAt: "2024-12-01T00:00:00Z" }, { target: "global" });
   *
   * // Emitiendo un evento dirigido a una instancia específica
   * eventBus.emit("cache.clear", null, { target: "instance-abc123" });
   * ```
   */
  emit(eventName: string, payload?: any, options?: EmitOptions): void {
    this.emitter.emit(eventName, payload);
  }

  /**
   * @description Registra un listener para un evento específico. El listener es una función que se ejecutará cada vez que se emita el evento con el nombre correspondiente. El payload del evento será pasado como argumento a la función del listener. Este método es utilizado para suscribirse a eventos y reaccionar a ellos cuando ocurren en la aplicación. (SE RECOMIENDA USAR LOS DECORADORES `@OnEvent` O `@OnceEvent` EN LUGAR DE ESTE MÉTODO PARA REGISTRAR LISTENERS EN CLASES DE SERVICIOS).
   * @param eventName El nombre del evento al que se desea suscribir. Este es un string que identifica el tipo de evento que se quiere escuchar.
   * @param listener La función que se ejecutará cuando se emita el evento. Recibirá el payload del evento como argumento.
   * @example
   * ```typescript
   * // Registrando un listener para el evento de usuario registrado
   * eventBus.on("user.registered", (payload) => {
   *   console.log(`Nuevo usuario registrado: ${payload.username}`);
   * });
   * ```
   */
  on(
    eventName: string,
    listener: (payload: any) => void | Promise<void>,
  ): void {
    this.emitter.on(eventName, listener);
  }

  /**
   * @description Elimina un listener registrado para un evento específico. Este método se utiliza para dejar de escuchar un evento en particular, evitando que la función del listener se ejecute cuando se emita el evento. Es importante proporcionar tanto el nombre del evento como la función del listener que se desea eliminar para que el EventBus pueda identificar correctamente cuál suscripción eliminar.
   * @param eventName El nombre del evento del cual se desea eliminar el listener. Este es un string que identifica el tipo de evento.
   * @param listener La función del listener que se desea eliminar. Debe ser la misma función que se registró previamente para el evento.
   * @example
   * ```typescript
   * // Eliminando un listener para el evento de usuario registrado
   * const userRegisteredListener = (payload) => {
   *   console.log(`Nuevo usuario registrado: ${payload.username}`);
   * };
   * eventBus.on("user.registered", userRegisteredListener);
   *
   * // Más tarde, si ya no queremos escuchar el evento
   * eventBus.off("user.registered", userRegisteredListener);
   * ```
   */
  off(
    eventName: string,
    listener: (payload: any) => void | Promise<void>,
  ): void {
    this.emitter.off(eventName, listener);
  }

  /**
   * @description Registra un listener para un evento específico que se ejecutará solo una vez. La función del listener se ejecutará la primera vez que se emita el evento con el nombre correspondiente, y luego se eliminará automáticamente, por lo que no se ejecutará en emisiones posteriores del mismo evento. Este método es útil para situaciones donde solo se necesita reaccionar a la primera ocurrencia de un evento, como la inicialización de un recurso o la respuesta a una acción única. (SE RECOMIENDA USAR LOS DECORADORES `@OnEvent` O `@OnceEvent` EN LUGAR DE ESTE MÉTODO PARA REGISTRAR LISTENERS EN CLASES DE SERVICIOS).
   * @param eventName El nombre del evento al que se desea suscribir para una sola ejecución. Este es un string que identifica el tipo de evento.
   * @param listener La función que se ejecutará la primera vez que se emita el evento. Recibirá el payload del evento como argumento. Después de la primera ejecución, esta función será eliminada automáticamente de las suscripciones del evento.
   * @example
   * ```typescript
   * // Registrando un listener para el evento de inicialización que solo se ejecutará una vez
   * eventBus.once("app.initialized", (payload) => {
   *   console.log("La aplicación ha sido inicializada");
   * });
   *
   * // Emitiendo el evento de inicialización
   * eventBus.emit("app.initialized");
   * // Emitiendo el evento de inicialización nuevamente no ejecutará el listener
   * eventBus.emit("app.initialized");
   * ```
   */
  once(
    eventName: string,
    listener: (payload: any) => void | Promise<void>,
  ): void {
    this.emitter.once(eventName, listener);
  }
}
