import { Injectable } from "../../container/injectable.decorator.js";
import { FastifyKitSocket } from "../interfaces/FastifyKitSocket.js";
import { WsAdapter } from "../interfaces/WsAdapter.js";
import {
  WS_ROOM_MANAGER_TOKEN,
  WsRoomManager,
} from "../interfaces/WsRoomManager.js";

@Injectable(WS_ROOM_MANAGER_TOKEN)
export class MemoryRoomManager implements WsRoomManager {
  // Mapa principal: nombre_de_sala => Map<socketId, Socket>
  private readonly rooms = new Map<string, Map<string, FastifyKitSocket>>();
  // Mapa inverso para optimizar leaveAll: socketId => Set<nombre_de_sala>
  private readonly socketRooms = new Map<string, Set<string>>();

  async join(
    socketId: string,
    room: string,
    socket: FastifyKitSocket,
  ): Promise<void> {
    // Si la sala no existe, la creamos
    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Map());
    }
    // Añadimos el socket a la sala
    this.rooms.get(room)!.set(socketId, socket);

    // Actualizamos el mapa inverso (basicamente el historial de salas del socket)
    if (!this.socketRooms.has(socketId)) {
      this.socketRooms.set(socketId, new Set());
    }
    this.socketRooms.get(socketId)!.add(room);
  }

  async leave(socketId: string, room: string): Promise<void> {
    // Si la sala existe
    if (this.rooms.has(room)) {
      // Removemos el socket de la sala
      const roomMap = this.rooms.get(room)!;
      roomMap.delete(socketId);

      // Si la sala quedó vacía, liberamos la memoria
      if (roomMap.size === 0) {
        this.rooms.delete(room);
      }
    }

    // Lo sacamos del historial del socket
    if (this.socketRooms.has(socketId)) {
      const sRooms = this.socketRooms.get(socketId)!;
      sRooms.delete(room);

      // Si el socket no pertenece a ninguna sala, lo limpiamos completamente
      if (sRooms.size === 0) {
        this.socketRooms.delete(socketId);
      }
    }
  }

  async leaveAll(socketId: string): Promise<void> {
    const rooms = this.socketRooms.get(socketId);

    // SI hay salas en el historial de conexiones del socket, las recorremos y lo removemos de cada una
    if (rooms) {
      // Usamos Array.from para evitar mutar el Set mientras iteramos sobre él
      for (const room of Array.from(rooms)) {
        await this.leave(socketId, room);
      }
    }
  }

  async getSocketsInRoom(room: string): Promise<FastifyKitSocket[]> {
    const roomSockets = this.rooms.get(room);
    if (!roomSockets) return [];
    // Devolvemos un array con los sockets conectados a la sala (usamos Array.from para convertir el Map en un array de valores)
    return Array.from(roomSockets.values());
  }

  async emitToRoom(
    room: string,
    pattern: string,
    payload: any,
    adapter: WsAdapter,
  ): Promise<void> {
    // Obtenemos los sockets conectados a la sala
    const sockets = await this.getSocketsInRoom(room);
    if (sockets.length === 0) return;

    // Codificamos el mensaje usando el adaptador
    // para asegurarnos de que el formato es correcto
    const encodedMessage = adapter.encode(pattern, payload);

    // Enviamos el mensaje a cada socket conectado a la sala
    for (const socket of sockets) {
      // Verificamos que el socket esté abierto antes de enviar el mensaje para evitar errores
      if (socket.readyState === 1) {
        socket.send(encodedMessage);
      }
    }
  }
}
