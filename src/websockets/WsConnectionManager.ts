import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { FastifyKitSocket } from "./interfaces/FastifyKitSocket.js";
import { WsAdapter } from "./interfaces/WsAdapter.js";
import { WsRoomManager } from "./interfaces/WsRoomManager.js";

/**
 * @description Gestor de conexiones WebSocket. Maneja el ciclo de vida
 * de las conexiones: heartbeat para detección de clientes muertos, limpieza
 * al cerrar el servidor, y asignación de metadata inicial en el socket.
 */
export class WsConnectionManager {
  /**
   * @description Configura el mecanismo de heartbeat (ping/pong) para detectar
   * y eliminar conexiones muertas, y el hook onClose para limpiar todo al apagar.
   */
  setupHeartbeatAndTeardown(app: FastifyInstance): void {
    // Simple flag para evitar configurar el heartbeat más de una vez si se llama a registerGateways varias veces.
    if ((app as any)._wsHeartbeatSetup) return;
    (app as any)._wsHeartbeatSetup = true;

    // Handler para limpiar conexiones muertas cada 30 segundos
    const pingInterval = setInterval(() => {
      // Si el servidor de WebSockets está activo
      if (app.websocketServer) {
        // Iteramos sobre todos los clientes conectados al servidor de WebSockets
        for (const client of app.websocketServer.clients) {
          const wsClient = client as any;
          // Si el cliente no respondió al último ping, lo matamos.
          if (wsClient.isAlive === false) {
            client.terminate();
            continue;
          }
          // Marcamos el cliente como no vivo y le enviamos un ping. Si responde, lo marcaremos como vivo en el handler de pong.
          wsClient.isAlive = false;
          client.ping();
        }
      }
    }, 30000);

    // Desvinculamos el intervalo para que no impida que el proceso se cierre naturalmente si no hay otras tareas pendientes
    pingInterval.unref();

    // Apagamos el intervalo de limpieza de conexiones muertas cuando el servidor se cierra para evitar memory leaks
    app.addHook("onClose", (instance, done) => {
      clearInterval(pingInterval);
      if (instance.websocketServer) {
        for (const client of instance.websocketServer.clients) {
          client.terminate();
        }
      }
      done();
    });
  }

  /**
   * @description Helper para inicializar el socket con la lógica del framework.
   */
  setupSocketMetadata(
    socket: FastifyKitSocket,
    path: string,
    roomManager: WsRoomManager,
    adapter: WsAdapter,
  ): void {
    // Registramos todos los metadatos para el socket
    socket.id = randomUUID();
    socket.isAlive = true;
    socket.data = {};
    socket.namespace = path;

    // Delegamos todos los metodos del socket al manager registrado para las salas
    socket.join = (room: string) =>
      roomManager.join(path, room, socket.id, socket);
    socket.leave = (room: string) => roomManager.leave(path, room, socket.id);
    socket.leaveAll = () => roomManager.leaveAll(socket.id);
    socket.to = (room: string) => ({
      emit: async (pattern: string, payload: any) =>
        roomManager.emitToRoom(path, room, pattern, payload, adapter),
    });
  }
}
