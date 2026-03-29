import { getLogger } from "../../logger/logger.factory.js";
import type { WsAdapter, FastifyKitWsPacket } from "../interfaces/WsAdapter.js";

/**
 * @description Adaptador de WebSockets que utiliza JSON como formato de mensaje. Este adaptador implementa la interfaz WsAdapter, proporcionando métodos para decodificar mensajes entrantes y codificar mensajes salientes en formato JSON.
 */
export class JsonWsAdapter implements WsAdapter {
  decode(rawMessage: string | Buffer): FastifyKitWsPacket {
    try {
      let text: string;

      // Si el mensaje es un string, lo usamos directamente.
      // Si es un Buffer, lo decodificamos a texto usando TextDecoder
      // (simulando la red nativa que envía mensajes como Buffer).
      if (typeof rawMessage === "string") {
        text = rawMessage;
      } else {
        text = new TextDecoder().decode(rawMessage);
      }

      // Intentamos parsear el texto como JSON.
      const parsed = JSON.parse(text);

      // Si el JSON tiene una estructura con "event" y "data", usamos esos campos. Si no, asumimos que el payload es el objeto completo.
      return {
        pattern: parsed.event || null,
        payload: parsed.data === undefined ? parsed : parsed.data,
      };
    } catch (e: any) {
      getLogger().warn(
        "Error al decodificar mensaje WebSocket. No es un JSON válido",
        e,
      );
      return {
        pattern: null,
        payload: rawMessage,
      };
    }
  }

  encode(pattern: string, data: any): string {
    // Codificamos el mensaje como un JSON con la estructura { event: pattern, data: payload }
    return JSON.stringify({ event: pattern, data });
  }
}
