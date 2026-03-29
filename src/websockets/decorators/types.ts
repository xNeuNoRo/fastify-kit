import { WsAdapter } from "../interfaces/WsAdapter.js";

/**
 * @description Metadata para los decoradores de eventos de WebSockets (connect, disconnect, message).
 */
export interface WsEventHandlerMetadata {
  handlerName: PropertyKey; // El nombre del método decorado (ej: "handleMessage")
  type: "connect" | "disconnect" | "message";
  pattern?: string; // Solo se usa si es de tipo "message" (ej: para @SubscribeMessage('EVENTO'))
}

/**
 * @description Metadata para el decorador \@WebSocketGateway, que se utiliza para marcar una clase como un gateway de WebSockets. Incluye la ruta del WebSocket y opcionalmente un adaptador personalizado para manejar la codificación y decodificación de mensajes.
 */
export interface WebSocketGatewayOptions {
  path: string;
  adapter?: new () => WsAdapter;
}
