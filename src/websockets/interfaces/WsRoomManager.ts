import { FastifyKitSocket } from "./FastifyKitSocket.js";
import { WsAdapter } from "./WsAdapter.js";

// Token para la inyección de dependencias
export const WS_ROOM_MANAGER_TOKEN = Symbol("WS_ROOM_MANAGER_TOKEN");

/**
 * @description Contrato estricto para el gestor de salas de WebSockets.
 * Cualquier implementación (Memoria, Redis, RabbitMQ) debe cumplir con esta interfaz
 * para garantizar la escalabilidad horizontal del framework.
 */
export interface WsRoomManager {
  /**
   * @description Une un socket a una sala específica.
   * @param namespace El namespace del Gateway al que pertenece la sala (ej: "/chat").
   * @param room El nombre de la sala.
   * @param socketId El ID único del socket.
   * @param socket La instancia del socket para poder enviarle mensajes luego.
   */
  join(
    namespace: string,
    room: string,
    socketId: string,
    socket: FastifyKitSocket,
  ): Promise<void>;

  /**
   * @description Remueve un socket de una sala específica.
   * @param socketId El ID único del socket a remover.
   * @param room El nombre de la sala.
   */
  leave(namespace: string, room: string, socketId: string): Promise<void>;

  /**
   * @description Remueve un socket de todas las salas a las que pertenece.
   * Esto es vital para evitar memory leaks cuando un usuario se desconecta.
   * @param socketId El ID único del socket que se está desconectando.
   */
  leaveAll(socketId: string): Promise<void>;

  /**
   * @description Obtiene todos los sockets actualmente conectados a una sala en la instancia actual.
   * @param room El nombre de la sala.
   * @returns Un array de sockets conectados.
   */
  getSocketsInRoom(
    namespace: string,
    room: string,
  ): Promise<FastifyKitSocket[]>;

  /**
   * @description Codifica y emite un mensaje a todos los sockets pertenecientes a una sala.
   * En arquitecturas multi-nodo (ej. Redis), este método también debería propagar el evento a otros servidores.
   * @param room El nombre de la sala destino.
   * @param pattern El patrón o nombre del evento a emitir.
   * @param payload Los datos a enviar.
   * @param adapter El adaptador de WebSockets actual para formatear el mensaje correctamente.
   */
  emitToRoom(
    namespace: string,
    room: string,
    pattern: string,
    payload: any,
    adapter: WsAdapter,
  ): Promise<void>;
}
