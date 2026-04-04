import type { WebSocket } from "ws";

/**
 * @description Extensión de la interfaz nativa WebSocket para añadir propiedades específicas de FastifyKit.
 * Provee un identificador único por conexión y un espacio seguro en memoria para guardar el contexto de la sesión.
 */
export interface FastifyKitSocket<
  TData = Record<string, any>,
> extends WebSocket {
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
