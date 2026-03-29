import { describe, it, expect, beforeEach, vi } from "vitest";

import { JsonWsAdapter } from "../../../../src/websockets/adapters/JsonWsAdapter.js";

describe("Adaptador JSON para WebSockets (JsonWsAdapter)", () => {
  const adapter = new JsonWsAdapter();

  beforeEach(() => {
    // Mockeamos console.warn para evitar logs de advertencia durante las pruebas de decodificación fallida
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  describe("Decodificación de mensajes (decode)", () => {
    it("Debería decodificar un string JSON válido y separar el patrón del payload", () => {
      const rawMessage = JSON.stringify({
        event: "NUEVO_MENSAJE",
        data: "Hola Mundo",
      });
      const packet = adapter.decode(rawMessage);

      expect(packet.pattern).toBe("NUEVO_MENSAJE");
      expect(packet.payload).toBe("Hola Mundo");
    });

    it("Debería decodificar un objeto completo como payload si no viene la propiedad 'data'", () => {
      const rawMessage = JSON.stringify({ event: "PING", timestamp: 123 });
      const packet = adapter.decode(rawMessage);

      expect(packet.pattern).toBe("PING");
      expect(packet.payload).toEqual({ event: "PING", timestamp: 123 });
    });

    it("Debería decodificar correctamente un Buffer binario simulando la red nativa", () => {
      const rawMessage = Buffer.from(
        JSON.stringify({ event: "AUTH", data: { token: "123" } }),
      );
      const packet = adapter.decode(rawMessage);

      expect(packet.pattern).toBe("AUTH");
      expect(packet.payload).toEqual({ token: "123" });
    });

    it("Debería manejar graceful degradation (Modo Firehose) si el cliente envía texto plano no-JSON", () => {
      const rawMessage = "Mensaje crudo";
      const packet = adapter.decode(rawMessage);

      expect(packet.pattern).toBeNull();
      expect(packet.payload).toBe("Mensaje crudo");
    });
  });

  describe("Codificación de mensajes (encode)", () => {
    it("Debería empaquetar la respuesta del controlador en el formato JSON de red", () => {
      const encoded = adapter.encode("RESPUESTA", { ok: true });
      expect(encoded).toBe(
        JSON.stringify({ event: "RESPUESTA", data: { ok: true } }),
      );
    });
  });
});
