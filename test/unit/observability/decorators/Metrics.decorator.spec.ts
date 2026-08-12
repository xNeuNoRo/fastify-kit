import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { container } from "../../../../src/container/DIContainer.js";
import { METRICS_SERVICE_TOKEN } from "../../../../src/observability/contracts/MetricsService.js";
import {
  Metrics,
  validateMetricLabels,
} from "../../../../src/observability/decorators/Metrics.js";

// Mock del metrics service
const mockMetrics = {
  increment: vi.fn(),
  decrement: vi.fn(),
  gauge: vi.fn(),
  histogram: vi.fn(),
  summary: vi.fn(),
  registerDefaultMetrics: vi.fn(),
  getMetricsEndpoint: vi.fn().mockReturnValue(""),
  getContentType: vi.fn().mockReturnValue("text/plain"),
};

describe("Decorador @Metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    container.registerInstance(METRICS_SERVICE_TOKEN, mockMetrics);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Contador (counter)", () => {
    it("Deberia incrementar el contador con status success en metodo sincrono", () => {
      class TestService {
        @Metrics({ counter: "test_total" })
        syncMethod() {
          return "ok";
        }
      }

      const service = new TestService();
      service.syncMethod();

      expect(mockMetrics.increment).toHaveBeenCalledWith(
        "test_total",
        { status: "success" },
        1,
      );
    });

    it("Deberia incrementar el contador con status error si el metodo falla", () => {
      class TestService {
        @Metrics({ counter: "test_errors" })
        errorMethod() {
          throw new Error("fallo");
        }
      }

      const service = new TestService();

      expect(() => service.errorMethod()).toThrow("fallo");
      expect(mockMetrics.increment).toHaveBeenCalledWith(
        "test_errors",
        { status: "error" },
        1,
      );
    });

    it("Deberia incrementar el contador con status success en metodo asincrono", async () => {
      class TestService {
        @Metrics({ counter: "async_total" })
        async asyncMethod() {
          await Promise.resolve();
          return "async-ok";
        }
      }

      const service = new TestService();
      await service.asyncMethod();

      expect(mockMetrics.increment).toHaveBeenCalledWith(
        "async_total",
        { status: "success" },
        1,
      );
    });

    it("Deberia incrementar el contador con labels personalizados", () => {
      class TestService {
        @Metrics({ counter: "custom_total", labels: { version: "v2" } })
        method() {
          return true;
        }
      }

      const service = new TestService();
      service.method();

      expect(mockMetrics.increment).toHaveBeenCalledWith(
        "custom_total",
        { version: "v2", status: "success" },
        1,
      );
    });
  });

  describe("Histograma (histogram)", () => {
    it("Deberia registrar una observacion en el histograma con la duracion", () => {
      class TestService {
        @Metrics({ histogram: "test_duration" })
        syncMethod() {
          return 42;
        }
      }

      const service = new TestService();
      service.syncMethod();

      expect(mockMetrics.histogram).toHaveBeenCalledTimes(1);
      const call = mockMetrics.histogram.mock.calls[0];
      expect(call[0]).toBe("test_duration");
      expect(typeof call[1]).toBe("number");
      expect(call[2]).toEqual({ status: "success" });
    });

    it("Deberia registrar duracion incluso en caso de error", () => {
      class TestService {
        @Metrics({ histogram: "error_duration" })
        errorMethod() {
          throw new Error("BOOM");
        }
      }

      const service = new TestService();

      expect(() => service.errorMethod()).toThrow("BOOM");
      expect(mockMetrics.histogram).toHaveBeenCalledTimes(1);
      const call = mockMetrics.histogram.mock.calls[0];
      expect(call[2].status).toBe("error");
    });
  });

  describe("Gauge", () => {
    it("Deberia incrementar el gauge al entrar y decrementarlo al salir", () => {
      class TestService {
        @Metrics({ gauge: "active_operations" })
        syncMethod() {
          return "done";
        }
      }

      const service = new TestService();
      service.syncMethod();

      expect(mockMetrics.gauge).toHaveBeenCalledTimes(2);
      expect(mockMetrics.gauge).toHaveBeenNthCalledWith(
        1,
        "active_operations",
        1,
        {},
      );
      expect(mockMetrics.gauge).toHaveBeenNthCalledWith(
        2,
        "active_operations",
        0,
        {},
      );
    });
  });

  describe("Fallback sin metrics", () => {
    it("Deberia ejecutar el metodo normalmente usando un metricsService minimo", () => {
      // Registramos un servicio minimo para probar el flujo
      container.registerInstance(METRICS_SERVICE_TOKEN, {
        increment: vi.fn(),
        histogram: vi.fn(),
        gauge: vi.fn(),
      });

      class TestService {
        @Metrics({ counter: "noop_total" })
        method() {
          return "noop-ok";
        }
      }

      const service = new TestService();
      const result = service.method();

      expect(result).toBe("noop-ok");
    });
  });

  describe("Validacion del decorador", () => {
    it("Deberia lanzar error si se aplica a algo que no es un metodo", () => {
      const applyToClass = () => {
        const decorator = Metrics({});
        decorator({} as any, { kind: "class" } as any);
      };

      expect(applyToClass).toThrow(
        "@Metrics solo puede ser aplicado a métodos de clase",
      );
    });
  });

  describe("validateMetricLabels() - Cardinality guard", () => {
    it("Deberia permitir labels que estan en el conjunto permitido", () => {
      const allowed = new Set(["version", "region"]);

      expect(() =>
        validateMetricLabels("test_metric", { version: "v1" }, allowed),
      ).not.toThrow();
    });

    it("Deberia lanzar error para labels no permitidas", () => {
      const allowed = new Set(["version"]);

      expect(() =>
        validateMetricLabels("test_metric", { userId: "123" }, allowed),
      ).toThrow('Label "userId" no permitida para la metrica "test_metric"');
    });
  });
});
