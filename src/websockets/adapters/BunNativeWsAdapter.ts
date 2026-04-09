import type { WsAdapter, FastifyKitWsPacket } from "../interfaces/WsAdapter.js";

/**
 * @description Adaptador de WebSockets ultra-optimizado para el runtime de Bun.
 * Aprovecha el parseo de JSON nativo de Bun y minimiza las transformaciones de Buffer.
 */
export class BunNativeWsAdapter implements WsAdapter {
  // Usamos una instancia única de TextDecoder para evitar recolección de basura constante
  private static readonly decoder = new TextDecoder();

  decode(rawMessage: string | Uint8Array | Buffer): FastifyKitWsPacket {
    try {
      let text: string;

      // Bun suele entregar Uint8Array para mensajes binarios, que es mucho más rápido que Buffer.
      if (typeof rawMessage === "string") {
        text = rawMessage;
      } else {
        text = BunNativeWsAdapter.decoder.decode(rawMessage);
      }

      // JSON.parse en Bun está escrito en Zig y es hasta 2x más rápido que en Node.js
      const parsed = JSON.parse(text);

      return {
        pattern: parsed.event || null,
        payload: parsed.data === undefined ? parsed : parsed.data,
      };
    } catch {
      // En caso de error, devolvemos el payload crudo sin logs pesados para no bloquear el event loop
      return {
        pattern: null,
        payload: rawMessage,
      };
    }
  }

  encode(pattern: string, data: any): string {
    // Bun optimiza el stringify para objetos pequeños/medianos de forma nativa
    return JSON.stringify({ event: pattern, data });
  }
}
