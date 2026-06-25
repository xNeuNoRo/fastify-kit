import { describe, it, expect } from "vitest";

import {
  ObservabilityConfigSchema,
  getDefaultObservabilityConfig,
  OBSERVABILITY_CONFIG_KEY,
} from "../../../../src/observability/contracts/ObservabilityConfig.js";

describe("Configuracion de Observabilidad (ObservabilityConfig)", () => {
  describe("getDefaultObservabilityConfig()", () => {
    it("Deberia devolver una configuracion por defecto con todos los campos", () => {
      const config = getDefaultObservabilityConfig();

      expect(config).toBeDefined();
      expect(config.serviceName).toBe("fastify-kit-app");
      expect(config.environment).toBe("development");
      expect(config.logging).toBeDefined();
      expect(config.logging.level).toBe("info");
      expect(config.logging.prettyPrint).toBe(true);
      expect(config.tracing).toBeDefined();
      expect(config.tracing.enabled).toBe(true);
      expect(config.tracing.sampler).toBe("parentbased_traceidratio");
      expect(config.tracing.ratio).toBe(0.1);
      expect(config.tracing.exporter).toBe("console");
      expect(config.metrics).toBeDefined();
      expect(config.metrics.enabled).toBe(true);
      expect(config.metrics.endpoint).toBe("/metrics");
      expect(config.instrumentations).toBeDefined();
      expect(config.instrumentations.http).toBe(true);
      expect(config.instrumentations.redis).toBe(true);
      expect(config.instrumentations.queue).toBe(true);
      expect(config.instrumentations.ws).toBe(true);
    });

    it("Deberia tener valores por defecto seguros para desarrollo", () => {
      const config = getDefaultObservabilityConfig();

      expect(config.tracing.exporter).toBe("console");
      expect(config.logging.prettyPrint).toBe(true);
    });
  });

  describe("ObservabilityConfigSchema", () => {
    it("Deberia definir un esquema TypeBox valido", () => {
      expect(ObservabilityConfigSchema).toBeDefined();
      expect(typeof ObservabilityConfigSchema).toBe("object");
    });
  });

  describe("OBSERVABILITY_CONFIG_KEY", () => {
    it("Deberia ser la clave 'observability'", () => {
      expect(OBSERVABILITY_CONFIG_KEY).toBe("observability");
    });
  });
});
