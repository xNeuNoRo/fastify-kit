import { describe, it, expect } from "vitest";

import { PromMetricsService } from "../../../../src/observability/implementations/PromMetricsService.js";

describe("Servicio de Metricas (PromMetricsService)", () => {
  const defaultConfig = {
    enabled: true,
    endpoint: "/metrics",
    defaultLabels: {},
  };

  describe("Inicializacion", () => {
    it("Deberia crear una instancia sin errores", () => {
      const metrics = new PromMetricsService(defaultConfig);

      expect(metrics).toBeDefined();
    });

    it("Deberia tener getMetricsEndpoint y getContentType funcionales", () => {
      const metrics = new PromMetricsService(defaultConfig);

      const contentType = metrics.getContentType();
      expect(contentType).toBeDefined();
      expect(typeof contentType).toBe("string");
    });
  });

  describe("Metodos de metricas (graceful degradation)", () => {
    it("Deberia no lanzar errores al incrementar sin prom-client cargado", () => {
      const metrics = new PromMetricsService(defaultConfig);

      expect(() => metrics.increment("test_counter")).not.toThrow();
      expect(() =>
        metrics.increment("test_counter", { status: "ok" }, 5),
      ).not.toThrow();
    });

    it("Deberia no lanzar errores al registrar histogramas sin prom-client cargado", () => {
      const metrics = new PromMetricsService(defaultConfig);

      expect(() => metrics.histogram("test_histogram", 0.15)).not.toThrow();
      expect(() =>
        metrics.histogram("test_histogram", 0.5, { route: "/test" }),
      ).not.toThrow();
    });

    it("Deberia no lanzar errores al usar gauge sin prom-client cargado", () => {
      const metrics = new PromMetricsService(defaultConfig);

      expect(() => metrics.gauge("test_gauge", 42)).not.toThrow();
      expect(() =>
        metrics.gauge("test_gauge", 0, { room: "general" }),
      ).not.toThrow();
    });

    it("Deberia no lanzar errores al decrementar sin prom-client cargado", () => {
      const metrics = new PromMetricsService(defaultConfig);

      expect(() => metrics.decrement("test_gauge")).not.toThrow();
      expect(() =>
        metrics.decrement("test_gauge", { instance: "a" }, 1),
      ).not.toThrow();
    });

    it("Deberia no lanzar errores al llamar summary sin prom-client cargado", () => {
      const metrics = new PromMetricsService(defaultConfig);

      expect(() => metrics.summary("test_summary", 100)).not.toThrow();
    });
  });

  describe("getMetricsEndpoint()", () => {
    it("Deberia devolver un string", () => {
      const metrics = new PromMetricsService(defaultConfig);
      const result = metrics.getMetricsEndpoint();

      expect(result).toBeDefined();
      expect(typeof result).toBe("string");
    });
  });

  describe("getContentType()", () => {
    it("Deberia devolver el Content-Type de Prometheus", () => {
      const metrics = new PromMetricsService(defaultConfig);
      expect(metrics.getContentType()).toBe("text/plain; charset=utf-8");
    });
  });
});
