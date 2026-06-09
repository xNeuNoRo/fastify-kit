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

type EventListener = (payload: any) => void | Promise<void>;

// Interfaz que define el contrato para el EventBus
export interface EventBusContract {
  emit(eventName: string, payload?: any, options?: EmitOptions): void;
  on(eventName: string, listener: EventListener): void;
  off(eventName: string, listener: EventListener): void;
  once(eventName: string, listener: EventListener): void;
}

// Token para identificar el EventBus en el contenedor de dependencias
export const EVENT_BUS_TOKEN = Symbol.for("EVENT_BUS_TOKEN");

/**
 * @description Nodo interno para el Árbol de Eventos.
 */
class EventNode {
  public listeners: EventListener[] = [];
  public children = new Map<string, EventNode>();
}

export class DefaultEventBus implements EventBusContract {
  private readonly root = new EventNode();
  private catchAllListeners: EventListener[] = [];
  private readonly maxListeners = 100;

  /**
   * @description Emite un evento con un nombre específico y un payload opcional.
   * Soporta wildcards locales de alto rendimiento sin expresiones regulares.
   * @param eventName El nombre del evento a emitir.
   * @param payload Opcional. Cualquier dato que se desee pasar a los listeners.
   * @param options Opcional. Configuración adicional para la emisión.
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
    // Emitimos a los listeners globales de catch-all ("*") 
    // antes de cualquier otro procesamiento, ya que deben recibir todos 
    // los eventos sin importar su nombre o destino.
    for (let i = 0; i < this.catchAllListeners.length; i++) { // NOSONAR
      this.catchAllListeners[i](payload);
    }

    // Separamos el nombre del evento en partes para navegar por el árbol de eventos.
    const parts = eventName.split(".");
    // Iniciamos el proceso de emisión recursivo desde la raíz del árbol.
    this.emitNode(this.root, parts, 0, payload);
  }

  /**
   * @description Motor recursivo interno que recorre el árbol evaluando caminos exactos y wildcards.
   */
  private emitNode(
    node: EventNode,
    parts: string[],
    index: number,
    payload: any,
  ): void {
    // Si la rama actual tiene un comodín tipo '**', se dispara sin importar lo que reste del path
    // Ejemplo: Si el listener es 'user.**' y emitimos 'user.profile.updated'
    const globChild = node.children.get("**");
    if (globChild) {
      for (let i = 0; i < globChild.listeners.length; i++) { // NOSONAR
        globChild.listeners[i](payload);
      }
    }

    // Si llegamos al final de los segmentos exactos, disparamos los listeners de este nodo
    if (index === parts.length) {
      for (let i = 0; i < node.listeners.length; i++) { // NOSONAR
        node.listeners[i](payload);
      }
      return;
    }

    const part = parts[index];

    // Camino 1: Coincidencia Exacta (ej: 'user.created' coincidiría solo con 'user.created')
    const exactChild = node.children.get(part);
    if (exactChild) {
      this.emitNode(exactChild, parts, index + 1, payload);
    }

    // Camino 2: Comodín de un solo segmento '*' (ej: 'user.*' coincidiría con 
    // 'user.created' pero no con 'user.profile.updated')
    const wildcardChild = node.children.get("*");
    if (wildcardChild) {
      this.emitNode(wildcardChild, parts, index + 1, payload);
    }
  }

  /**
   * @description Registra un listener para un evento.
   * Puedes usar el comodín "*" para atrapar todos los eventos globalmente,
   * o usar sub-comodines como "user.*" o "user.**".
   * @param eventName El nombre del evento para el que se desea registrar el listener.
   * @param listener La función que se ejecutará cuando se emita el evento. Recibe el payload como argumento.
   * @example
   * ```typescript
   * // Registrando un listener para eventos de usuario
   * eventBus.on("user.*", (payload) => {
   *   console.log("Evento de usuario recibido:", payload);
   * });
   *
   * // Registrando un listener global para todos los eventos
   * eventBus.on("*", (payload) => {
   *   console.log("Evento global recibido:", payload);
   * });
   * ```
   */
  on(eventName: string, listener: EventListener): void {
    // Registro exclusivo para el catch global explicitamente con "*"
    if (eventName === "*") {
      this.checkMemoryLeak(eventName, this.catchAllListeners.length);
      this.catchAllListeners.push(listener);
      return;
    }

    const node = this.getOrCreateNode(eventName);
    this.checkMemoryLeak(eventName, node.listeners.length);
    node.listeners.push(listener);
  }

  /**
   * @description Elimina un listener registrado para un evento específico.
   * @param eventName El nombre del evento del que se desea eliminar el listener.
   * @param listener La función del listener que se desea eliminar.
   * @example
   * ```typescript
   * const onUserCreated = (payload) => {
   *   console.log("Usuario creado:", payload);
   * };
   * eventBus.on("user.created", onUserCreated);
   *
   * // Luego, para eliminar el listener:
   * eventBus.off("user.created", onUserCreated);
   * ```
   */
  off(eventName: string, listener: EventListener): void {
    if (eventName === "*") {
      this.catchAllListeners = this.catchAllListeners.filter(
        (l) => l !== listener && (l as any).originalListener !== listener,
      );
      return;
    }

    const node = this.findNode(eventName);
    if (node) {
      // Filtramos considerando también si el listener fue envuelto por once()
      node.listeners = node.listeners.filter(
        (l) => l !== listener && (l as any).originalListener !== listener,
      );
    }
  }

  /**
   * @description Registra un listener para un evento específico que se ejecutará solo una vez.
   * @param eventName El nombre del evento para el que se desea registrar el listener de una sola ejecución.
   * @param listener La función del listener que se desea ejecutar solo la primera vez que se emita el evento.
   * @example
   * ```typescript
   * // Registrando un listener que solo se ejecutará la primera vez que se emita 'user.created'
   * eventBus.once("user.created", (payload) => {
   *   console.log("Este mensaje solo aparecerá la primera vez que se cree un usuario:", payload);
   * });
   * ```
   */
  once(eventName: string, listener: EventListener): void {
    const wrapper = (payload: any) => {
      this.off(eventName, wrapper);
      listener(payload);
    };

    // Almacenamos la referencia original para que .off() pueda encontrarlo
    (wrapper as any).originalListener = listener;
    this.on(eventName, wrapper);
  }

  /**
   * @description Advertencia de fuga de memoria idéntica al EventEmitter de Node.js
   */
  private checkMemoryLeak(eventName: string, currentCount: number): void {
    if (currentCount >= this.maxListeners) {
      console.warn(
        `[FastifyKit EventBus] Memory Leak Warning: El evento "${eventName}" ha excedido los ${this.maxListeners} listeners registrados.`,
      );
    }
  }

  /**
   * @description Navega o construye las ramas del árbol para suscribirse
   */
  private getOrCreateNode(eventName: string): EventNode {
    const parts = eventName.split(".");
    let current = this.root;

    for (let i = 0; i < parts.length; i++) { // NOSONAR
      const part = parts[i];
      let next = current.children.get(part);
      if (!next) {
        next = new EventNode();
        current.children.set(part, next);
      }
      current = next;
    }
    return current;
  }

  /**
   * @description Encuentra un nodo existente sin mutarlo (usado en off)
   */
  private findNode(eventName: string): EventNode | undefined {
    const parts = eventName.split(".");
    let current = this.root;

    for (let i = 0; i < parts.length; i++) { // NOSONAR
      const next = current.children.get(parts[i]);
      if (!next) return undefined;
      current = next;
    }
    return current;
  }
}
