/**
 * @description Interfaz que define los métodos mínimos que debe tener un socket
 * para ser compatible con FastifyKit, ya sea en Node.js o Bun.
 */
export interface BaseWebSocket {
  /** @description Estado de la conexión (OPEN, CLOSED, etc) */
  readyState: number;
  /** @description Envía datos al cliente. Soporta strings y formatos binarios nativos. */
  send(
    data: string | Uint8Array | Buffer,
    options?: { compress?: boolean; binary?: boolean },
  ): void;
  /** @description Cierra la conexión de forma controlada. */
  close(code?: number, reason?: string): void;
  /** @description Cierra la conexión inmediatamente (específico de ws, opcional en Bun). */
  terminate?(): void;
  /** @description Envía un frame de ping (gestionado automáticamente por Bun). */
  ping?(): void;
}

/**
 * @description Extensión de la interfaz nativa WebSocket para añadir propiedades específicas de FastifyKit.
 * Provee un identificador único por conexión y un espacio seguro en memoria para guardar el contexto de la sesión.
 */
export interface FastifyKitSocket<
  TData = Record<string, any>,
> extends BaseWebSocket {
  /**
   * @description Identificador único (UUID) generado automáticamente al establecer la conexión.
   */
  id: string;
  /**
   * @description Propiedad interna utilizada por el mecanismo de heartbeat (ping/pong) para limpiar conexiones muertas.
   */
  isAlive: boolean;
  /**
   * @description Objeto de datos personalizado que puede ser utilizado por el desarrollador
   * para almacenar información relevante a la sesión, como el usuario autenticado,
   * roles, preferencias, etc. Este objeto es completamente flexible y se inicializa como un objeto vacío por defecto.
   */
  data: TData;

  /**
   * @description El namespace al que pertenece este socket,
   * esto permite a los handlers diferenciar la lógica si manejan múltiples namespaces.
   */
  namespace: string;

  /**
   * @description Une este socket a una sala específica.
   * @param room El nombre de la sala a la que se unirá el socket.
   */
  join(room: string): Promise<void>;

  /**
   * @description Remueve este socket de una sala específica.
   * @param room El nombre de la sala de la que saldrá el socket.
   */
  leave(room: string): Promise<void>;

  /**
   * @description Remueve este socket de todas las salas a las que pertenece.
   */
  leaveAll(): Promise<void>;

  /**
   * @description Obtiene un emisor dirigido exclusivamente a los miembros de una sala.
   * @param room El nombre de la sala a la que se enviará el mensaje.
   * @example
   * client.to("admins").emit("nuevo-usuario", { id: 1 });
   */
  to(room: string): {
    emit(pattern: string, payload: any): Promise<void>;
  };
}
