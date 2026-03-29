/**
 * @description Representa el paquete efimero que se envía a través de WebSockets utilizando FastifyKit.
 */
export interface FastifyKitWsPacket {
  pattern: string | null;
  payload: any;
}

/**
 * @description Interfaz que define el contrato para los adaptadores de WebSockets en FastifyKit. Cualquier adaptador de WebSockets debe implementar estos métodos para decodificar los mensajes entrantes y codificar los mensajes salientes de acuerdo con el formato esperado por FastifyKit.
 */
export interface WsAdapter {
  decode(rawMessage: any): FastifyKitWsPacket;
  encode(pattern: string, payload: any): any;
}
