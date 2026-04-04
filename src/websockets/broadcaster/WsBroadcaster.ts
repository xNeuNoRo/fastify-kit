import { Injectable } from "../../container/injectable.decorator.js";
import { getRoomManager } from "../managers/room-manager.factory.js";
import { JsonWsAdapter } from "../adapters/JsonWsAdapter.js";
import type { WsAdapter } from "../interfaces/WsAdapter.js";
import { container } from "../../container/DIContainer.js";

/**
 * @description Servicio inyectable para emitir mensajes de WebSocket de forma proactiva
 * desde cualquier parte de la aplicación (Controladores HTTP, Cron Jobs, Eventos, etc).
 */
@Injectable()
export class WsBroadcaster {
  private readonly defaultAdapter: WsAdapter = new JsonWsAdapter();

  /**
   * @description Emite un mensaje a todos los sockets conectados a una sala específica.
   * @param room El nombre de la sala destino.
   * @param pattern El patrón o nombre del evento a emitir.
   * @param payload Los datos a enviar a los clientes.
   * @param customAdapter Adaptador opcional si la sala requiere un formato distinto al JSON por defecto.
   */
  async emitToRoom(
    room: string,
    pattern: string,
    payload: any,
    customAdapter?: WsAdapter,
  ): Promise<void> {
    const roomManager = getRoomManager();
    const adapter = customAdapter || this.defaultAdapter;

    await roomManager.emitToRoom(room, pattern, payload, adapter);
  }

  /**
   * @description Emite un mensaje a múltiples salas a la vez.
   * @param rooms Array con los nombres de las salas destino.
   * @param pattern El patrón o nombre del evento a emitir.
   * @param payload Los datos a enviar a los clientes.
   */
  async emitToRooms(
    rooms: string[],
    pattern: string,
    payload: any,
  ): Promise<void> {
    // Usamos Promise.all para emitir a todas las salas en paralelo
    await Promise.all(
      rooms.map((room) => this.emitToRoom(room, pattern, payload)),
    );
  }
}


/**
 * @description Facade de la clase WsBroadcaster para emitir mensajes a salas de WebSocket sin necesidad de resolver el servicio manualmente.
 * @param room El nombre de la sala destino.
 * @param pattern El patrón o nombre del evento a emitir.
 * @param payload Los datos a enviar a los clientes.
 */
export async function broadcastToRoom(
  room: string,
  pattern: string,
  payload: any,
) {
  // Resolvemos el singleton desde el contenedor mágicamente
  const broadcaster = container.resolve(WsBroadcaster);
  await broadcaster.emitToRoom(room, pattern, payload);
}

/**
 * @description Facade de la clase WsBroadcaster para emitir mensajes a múltiples salas sin necesidad de resolver el servicio manualmente.
 * @param rooms Array con los nombres de las salas destino.
 * @param pattern El patrón o nombre del evento a emitir.
 * @param payload Los datos a enviar a los clientes.
 */
export async function broadcastToRooms(
  rooms: string[],
  pattern: string,
  payload: any,
) {
  // Resolvemos el singleton desde el contenedor mágicamente
  const broadcaster = container.resolve(WsBroadcaster);
  await broadcaster.emitToRooms(rooms, pattern, payload);
}
