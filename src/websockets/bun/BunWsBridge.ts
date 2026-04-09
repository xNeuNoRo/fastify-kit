import type { ServerWebSocket, WebSocketHandler } from "bun";
import type { BunSocketContext, BunGatewayExecutionConfig } from "./types.js";
import type { FastifyKitSocket } from "../interfaces/FastifyKitSocket.js";
import type { FastifyRequest } from "fastify";

/**
 * @description Orquestador que conecta los eventos de red nativos de Bun (Zig)
 * con la lógica de controladores y decoradores de FastifyKit.
 */
export class BunWsBridge {
  // Registro estático de rutas para resolución O(1)
  private static readonly registry = new Map<
    string,
    BunGatewayExecutionConfig
  >();

  // Aislamiento de estado para evitar que setupSocketMetadata() borre el contexto de Bun
  private static readonly socketMeta = new WeakMap<
    any,
    { config: BunGatewayExecutionConfig; request: FastifyRequest }
  >();

  /**
   * @description Registra la configuración de un Gateway para ser manejado por Bun.
   */
  static register(path: string, config: BunGatewayExecutionConfig): void {
    this.registry.set(path, config);
  }

  /**
   * @description El controlador de eventos que se inyectará en el objeto websocket de Bun.serve().
   * Devuelve un objeto que cumple estrictamente con el contrato WebSocketHandler de Bun.
   */
  static get handler(): WebSocketHandler<BunSocketContext> {
    return {
      // Bun abre la conexión y nos entrega el socket con los datos que inyectamos en el upgrade
      open: async (ws: ServerWebSocket<BunSocketContext>) => {
        const path = ws.data.path;
        const request = ws.data.request;
        const config = BunWsBridge.registry.get(path);

        if (config) {
          // Guardamos la configuración y la request en la bóveda segura del WeakMap
          BunWsBridge.socketMeta.set(ws, { config, request });

          if (config.onConnect) {
            // Convertimos el socket nativo de Bun a nuestra interfaz compatible
            // TS lo permite porque BaseWebSocket es un subconjunto de ServerWebSocket
            const kitSocket = ws as unknown as FastifyKitSocket;
            await config.onConnect(kitSocket, request);
          }
        }
      },

      // Procesamiento de mensajes entrantes (Binarios o Texto)
      message: async (
        ws: ServerWebSocket<BunSocketContext>,
        message: string | Buffer | Uint8Array,
      ) => {
        // Leemos de nuestra bóveda segura, ignorando totalmente ws.data
        const meta = BunWsBridge.socketMeta.get(ws);

        if (meta) {
          const kitSocket = ws as unknown as FastifyKitSocket;
          await meta.config.process(kitSocket, message, meta.request);
        }
      },

      // Limpieza de recursos al cerrar la conexión
      close: async (ws: ServerWebSocket<BunSocketContext>) => {
        const meta = BunWsBridge.socketMeta.get(ws);

        if (meta?.config?.onDisconnect) {
          const kitSocket = ws as unknown as FastifyKitSocket;
          await meta.config.onDisconnect(kitSocket);
        }
      },
    };
  }
}
