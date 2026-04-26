import { Injectable } from "../../container/injectable.decorator.js";
import { FastifyKitSocket } from "../interfaces/FastifyKitSocket.js";
import { WsAdapter } from "../interfaces/WsAdapter.js";
import {
  WS_ROOM_MANAGER_TOKEN,
  WsRoomManager,
} from "../interfaces/WsRoomManager.js";

@Injectable(WS_ROOM_MANAGER_TOKEN)
export class MemoryRoomManager implements WsRoomManager {
  // Mapa principal. Clave compuesta: "namespace:room" => Map<socketId, Socket>
  private readonly rooms = new Map<string, Map<string, FastifyKitSocket>>();
  // Mapa inverso para optimizar leaveAll: socketId => Set<"namespace:room">
  private readonly socketRooms = new Map<string, Set<string>>();

  // Utilidad para obtener la clave compuesta del mapa principal a partir del namespace y la sala
  private getRoomKey(namespace: string, room: string): string {
    return `${namespace}:${room}`;
  }

  async join(
    namespace: string,
    room: string,
    socketId: string,
    socket: FastifyKitSocket,
  ): Promise<void> {
    const roomKey = this.getRoomKey(namespace, room);

    // Si la sala en ese namespace no existe, la creamos
    if (!this.rooms.has(roomKey)) {
      this.rooms.set(roomKey, new Map());
    }
    // Añadimos el socket a la sala
    this.rooms.get(roomKey)!.set(socketId, socket);

    // Actualizamos el historial de salas del socket
    if (!this.socketRooms.has(socketId)) {
      this.socketRooms.set(socketId, new Set());
    }

    // Guardamos explícitamente la referencia al namespace y la sala
    this.socketRooms.get(socketId)!.add(roomKey);
  }

  private removeSocketFromRoomByKey(roomKey: string, socketId: string): void {
    // Si la sala existe
    if (this.rooms.has(roomKey)) {
      // Removemos el socket de la sala
      const roomMap = this.rooms.get(roomKey)!;
      roomMap.delete(socketId);

      // Si la sala quedó vacía, liberamos la memoria
      if (roomMap.size === 0) {
        this.rooms.delete(roomKey);
      }
    }
  }

  async leave(
    namespace: string,
    room: string,
    socketId: string,
  ): Promise<void> {
    const roomKey = this.getRoomKey(namespace, room);

    // Removemos el socket de la sala
    this.removeSocketFromRoomByKey(roomKey, socketId);

    // Lo sacamos del historial del socket
    if (this.socketRooms.has(socketId)) {
      const sRooms = this.socketRooms.get(socketId)!;

      // Buscamos y eliminamos la entrada exacta
      sRooms.delete(roomKey);

      // Si el socket no pertenece a ninguna sala, lo limpiamos completamente
      if (sRooms.size === 0) {
        this.socketRooms.delete(socketId);
      }
    }
  }

  async leaveAll(socketId: string): Promise<void> {
    const rooms = this.socketRooms.get(socketId);
    // Si el socket no tiene salas en su historial, no hay nada que hacer
    if (!rooms) return;

    // Iteramos por todas las salas a las que el socket pertenece y lo removemos
    for (const roomKey of rooms) {
      this.removeSocketFromRoomByKey(roomKey, socketId);
    }

    // Como estamos sacando el socket de TODAS partes, en lugar de borrar una por una,
    // simplemente eliminamos su historial completo para liberar memoria
    this.socketRooms.delete(socketId);
  }

  async getSocketsInRoom(
    namespace: string,
    room: string,
  ): Promise<FastifyKitSocket[]> {
    const roomKey = this.getRoomKey(namespace, room);
    const roomSockets = this.rooms.get(roomKey);

    if (!roomSockets) return [];

    // Devolvemos un array con los sockets conectados a la sala
    return Array.from(roomSockets.values());
  }

  async emitToRoom(
    namespace: string,
    room: string,
    pattern: string,
    payload: any,
    adapter: WsAdapter,
    excludeSockets?: string[],
  ): Promise<void> {
    // Obtenemos los sockets conectados a la sala en el namespace correcto
    const sockets = await this.getSocketsInRoom(namespace, room);
    if (sockets.length === 0) return;

    // Creamos un Set de exclusión para optimizar la búsqueda
    // si se proporcionó una lista de sockets a excluir
    const exclusionSet =
      excludeSockets && excludeSockets.length > 0
        ? new Set(excludeSockets)
        : null;

    // Codificamos el mensaje usando el adaptador
    // para asegurarnos de que el formato es correcto
    const encodedMessage = adapter.encode(pattern, payload);

    // Enviamos el mensaje a cada socket conectado a la sala
    for (const socket of sockets) {
      // Saltamos los sockets que están en la lista de exclusión
      if (exclusionSet?.has(socket.id)) {
        continue;
      }

      // Verificamos que el socket esté abierto antes de enviar el mensaje para evitar errores
      if (socket.readyState === 1) {
        socket.send(encodedMessage);
      }
    }
  }
}
