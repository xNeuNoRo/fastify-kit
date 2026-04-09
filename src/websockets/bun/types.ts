import type { FastifyRequest } from "fastify";
import type { WsAdapter } from "../interfaces/WsAdapter.js";
import type { FastifyKitSocket } from "../interfaces/FastifyKitSocket.js";

/**
 * @description Datos que Bun adjuntará internamente a cada conexión.
 * Se utiliza para mapear la conexión con su ruta y request original en el upgrade.
 */
export interface BunSocketContext {
  path: string;
  request: FastifyRequest;
}

/**
 * @description Configuración de ejecución que el Bridge usará para cada Gateway.
 * Define cómo el motor de Bun debe orquestar los eventos hacia los controladores
 * manteniendo el tipado de FastifyKit.
 */
export interface BunGatewayExecutionConfig {
  adapter: WsAdapter;
  onConnect?: (
    socket: FastifyKitSocket,
    request: FastifyRequest,
  ) => Promise<void>;
  onDisconnect?: (socket: FastifyKitSocket) => Promise<void>;
  process: (
    socket: FastifyKitSocket,
    message: string | Buffer | Uint8Array,
    request: FastifyRequest,
  ) => Promise<void>;
}
