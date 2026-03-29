import { getLogger } from "../../logger/logger.factory.js";
import type { WsAdapter, FastifyKitWsPacket } from "../interfaces/WsAdapter.js";

/**
 * @description Adaptador de WebSockets que utiliza JSON como formato de mensaje. Este adaptador implementa la interfaz WsAdapter, proporcionando métodos para decodificar mensajes entrantes y codificar mensajes salientes en formato JSON.
 */
export class JsonWsAdapter implements WsAdapter {
  decode(rawMessage: string | Buffer): FastifyKitWsPacket {
    let text: string = "";

    try {
      // Si el mensaje es un string, lo usamos directamente.
      // Si es un Buffer, lo convertimos a string usando UTF-8.
      // Si es un ArrayBuffer u otro tipo de dato, intentamos decodificarlo con TextDecoder.
      if (typeof rawMessage === "string") {
        text = rawMessage;
      } else if (Buffer.isBuffer(rawMessage)) {
        text = rawMessage.toString("utf-8");
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
        payload: text || rawMessage,
      };
    }
  }

  encode(pattern: string, data: any): string {
    return JSON.stringify({ event: pattern, data });
  }
}
