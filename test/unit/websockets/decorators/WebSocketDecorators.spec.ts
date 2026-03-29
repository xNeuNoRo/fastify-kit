import { describe, it, expect } from "vitest";

import type { FastifyKitMetadata } from "../../../../src/http/decorators/types.js";
import { JsonWsAdapter } from "../../../../src/websockets/adapters/JsonWsAdapter.js";
import {
  OnConnect,
  OnDisconnect,
  SubscribeMessage,
  OnMessage,
} from "../../../../src/websockets/decorators/events.js";
import { WebSocketGateway } from "../../../../src/websockets/decorators/gateway.js";

const metadataSymbol: symbol =
  (Symbol as SymbolConstructor & { metadata?: symbol }).metadata ??
  Symbol.for("Symbol.metadata");

describe("Decoradores de WebSockets", () => {
  describe("Decorador @WebSocketGateway", () => {
    it("Debería registrar correctamente la ruta (path) usando un string", () => {
      @WebSocketGateway("/ws/chat")
      class ChatGateway {}

      const metadata = (ChatGateway as any)[
        metadataSymbol
      ] as FastifyKitMetadata;

      expect(metadata).toBeDefined();
      expect(metadata.wsGateway).toBeDefined();
      expect(metadata.wsGateway?.path).toBe("/ws/chat");
      expect(metadata.wsGateway?.adapter).toBeUndefined();
    });

    it("Debería registrar la ruta y el adapter usando un objeto de opciones", () => {
      class CustomAdapter extends JsonWsAdapter {}

      @WebSocketGateway({ path: "/ws/iot", adapter: CustomAdapter })
      class IoTGateway {}

      const metadata = (IoTGateway as any)[
        metadataSymbol
      ] as FastifyKitMetadata;

      expect(metadata.wsGateway?.path).toBe("/ws/iot");
      expect(metadata.wsGateway?.adapter).toBe(CustomAdapter);
    });
  });

  describe("Decoradores de Eventos (@OnConnect, @SubscribeMessage, @OnMessage, @OnDisconnect)", () => {
    it("Debería inyectar la metadata de los eventos en el arreglo wsEvents de la clase", () => {
      @WebSocketGateway("/ws/test")
      class TestEventsGateway {
        @OnConnect() handleConnect() {
          /* dummy method */
        }
        @SubscribeMessage("NUEVO_MENSAJE") handleMessage() {
          /* dummy method */
        }
        @OnMessage() handleRawMessage() {
          /* dummy method */
        }
        @OnDisconnect() handleDisconnect() {
          /* dummy method */
        }
      }

      const metadata = (TestEventsGateway as any)[
        metadataSymbol
      ] as FastifyKitMetadata;

      expect(metadata.wsEvents).toBeDefined();
      expect(metadata.wsEvents).toHaveLength(4);

      const events = metadata.wsEvents;

      expect(events).toContainEqual({
        handlerName: "handleConnect",
        type: "connect",
        pattern: undefined,
      });
      expect(events).toContainEqual({
        handlerName: "handleMessage",
        type: "message",
        pattern: "NUEVO_MENSAJE",
      });
      expect(events).toContainEqual({
        handlerName: "handleRawMessage",
        type: "message",
        pattern: undefined,
      });
      expect(events).toContainEqual({
        handlerName: "handleDisconnect",
        type: "disconnect",
        pattern: undefined,
      });
    });
  });
});
