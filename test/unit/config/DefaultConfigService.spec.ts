import { describe, it, expect, beforeEach } from "vitest";

import { DefaultConfigService } from "../../../src/config/DefaultConfigService.js";
import type { DistributedOptions } from "../../../src/core/interfaces/distributed.interface.js";
import type { QueueOptions } from "../../../src/core/interfaces/queue.interface.js";
import type { FastifyKitWebRtcConfig } from "../../../src/core/interfaces/webrtc.interface.js";

describe("DefaultConfigService — Servicio de Configuración Inyectable", () => {
  let service: DefaultConfigService;

  beforeEach(() => {
    service = new DefaultConfigService();
  });

  describe("Config interna del framework (tipada)", () => {
    const mockQueue: QueueOptions = {
      strategy: "in-process",
      poolSize: 4,
    };

    const mockDistributed: DistributedOptions = {
      redis: { host: "redis.local", port: 6380 },
    } as DistributedOptions;

    const mockWebRtc: FastifyKitWebRtcConfig = {
      portRange: { min: 10000, max: 20000 },
    } as FastifyKitWebRtcConfig;

    it("Debería guardar y recuperar configuración de colas (queue)", () => {
      service.set("queue", mockQueue);
      const recovered = service.get("queue");
      expect(recovered).toBeDefined();
      expect(recovered).toEqual(mockQueue);
    });

    it("Debería guardar y recuperar configuración distribuida (distributed)", () => {
      service.set("distributed", mockDistributed);
      const recovered = service.get("distributed");
      expect(recovered).toBeDefined();
      expect(recovered).toEqual(mockDistributed);
    });

    it("Debería guardar y recuperar configuración WebRTC", () => {
      service.set("webrtc", mockWebRtc);
      const recovered = service.get("webrtc");
      expect(recovered).toBeDefined();
      expect(recovered).toEqual(mockWebRtc);
    });

    it("Debería retornar undefined para config interna no registrada", () => {
      const recovered = service.get("queue");
      expect(recovered).toBeUndefined();
    });

    it("has() debería retornar true si la config interna existe", () => {
      service.set("queue", mockQueue);
      expect(service.has("queue")).toBe(true);
    });

    it("has() debería retornar false para config interna no registrada", () => {
      expect(service.has("queue")).toBe(false);
      expect(service.has("distributed")).toBe(false);
    });

    it("Debería permitir múltiples configs internas independientes", () => {
      service.set("queue", mockQueue);
      service.set("distributed", mockDistributed);
      service.set("webrtc", mockWebRtc);

      expect(service.has("queue")).toBe(true);
      expect(service.has("distributed")).toBe(true);
      expect(service.has("webrtc")).toBe(true);

      expect(service.get("queue")).toEqual(mockQueue);
      expect(service.get("distributed")).toEqual(mockDistributed);
      expect(service.get("webrtc")).toEqual(mockWebRtc);
    });

    it("Debería sobrescribir config interna existente", () => {
      service.set("queue", mockQueue);

      const newQueue: QueueOptions = {
        strategy: "redis",
        poolSize: 8,
      };
      service.set("queue", newQueue);

      const recovered = service.get("queue");
      expect(recovered).toEqual(newQueue);
      expect(recovered).not.toEqual(mockQueue);
    });
  });

  describe("Config genérica de usuario (string namespace)", () => {
    it("setConfig/getConfig: Debería guardar y recuperar config por namespace string", () => {
      service.setConfig("DATABASE_URL", "postgres://localhost:5432/mydb");
      expect(service.getConfig("DATABASE_URL")).toBe(
        "postgres://localhost:5432/mydb",
      );
    });

    it("getConfig: Debería retornar undefined para namespace no registrado", () => {
      expect(service.getConfig("INEXISTENTE")).toBeUndefined();
    });

    it("hasConfig: Debería retornar true si la config existe", () => {
      service.setConfig("PORT", 3000);
      expect(service.hasConfig("PORT")).toBe(true);
    });

    it("hasConfig: Debería retornar false para config no registrada", () => {
      expect(service.hasConfig("PORT")).toBe(false);
    });

    it("Debería soportar valores numéricos en config genérica", () => {
      service.setConfig("PORT", 3000);
      expect(service.getConfig<number>("PORT")).toBe(3000);
    });

    it("Debería soportar valores booleanos en config genérica", () => {
      service.setConfig("DEBUG", true);
      expect(service.getConfig<boolean>("DEBUG")).toBe(true);
      service.setConfig("VERBOSE", false);
      expect(service.getConfig<boolean>("VERBOSE")).toBe(false);
    });

    it("Debería soportar objetos complejos en config genérica", () => {
      const dbConfig = {
        host: "localhost",
        port: 5432,
        pool: { min: 2, max: 10 },
      };
      service.setConfig("database", dbConfig);
      const recovered = service.getConfig<typeof dbConfig>("database");
      expect(recovered).toEqual(dbConfig);
      expect(recovered?.pool.min).toBe(2);
    });

    it("Debería sobrescribir config genérica existente", () => {
      service.setConfig("PORT", 3000);
      service.setConfig("PORT", 8080);
      expect(service.getConfig<number>("PORT")).toBe(8080);
    });

    it("Debería manejar múltiples namespaces independientes", () => {
      service.setConfig("HOST", "0.0.0.0");
      service.setConfig("PORT", 3000);
      service.setConfig("DEBUG", true);

      expect(service.getConfig("HOST")).toBe("0.0.0.0");
      expect(service.getConfig<number>("PORT")).toBe(3000);
      expect(service.getConfig<boolean>("DEBUG")).toBe(true);

      expect(service.hasConfig("HOST")).toBe(true);
      expect(service.hasConfig("PORT")).toBe(true);
      expect(service.hasConfig("DEBUG")).toBe(true);
    });

    it("Debería preservar valores falsy válidos (0, false, '')", () => {
      service.setConfig("MAX_RETRIES", 0);
      service.setConfig("FEATURE_FLAG", false);
      service.setConfig("PREFIX", "");

      expect(service.getConfig("MAX_RETRIES")).toBe(0);
      expect(service.getConfig("FEATURE_FLAG")).toBe(false);
      expect(service.getConfig("PREFIX")).toBe("");
    });
  });

  describe("clear()", () => {
    it("Debería limpiar toda la config interna", () => {
      service.set("queue", {
        strategy: "in-process",
        poolSize: 4,
      } as QueueOptions);
      expect(service.has("queue")).toBe(true);

      service.clear();
      expect(service.has("queue")).toBe(false);
      expect(service.get("queue")).toBeUndefined();
    });

    it("Debería limpiar toda la config genérica", () => {
      service.setConfig("PORT", 3000);
      expect(service.hasConfig("PORT")).toBe(true);

      service.clear();
      expect(service.hasConfig("PORT")).toBe(false);
      expect(service.getConfig("PORT")).toBeUndefined();
    });

    it("Debería limpiar tanto config interna como genérica simultáneamente", () => {
      service.set("queue", {
        strategy: "in-process",
        poolSize: 4,
      } as QueueOptions);
      service.setConfig("DATABASE_URL", "postgres://localhost");

      service.clear();

      expect(service.has("queue")).toBe(false);
      expect(service.hasConfig("DATABASE_URL")).toBe(false);
    });

    it("Debería ser idempotente (llamar clear() múltiples veces no falla)", () => {
      service.setConfig("PORT", 3000);
      service.clear();
      service.clear();
      service.clear();
      expect(service.hasConfig("PORT")).toBe(false);
    });
  });
});
