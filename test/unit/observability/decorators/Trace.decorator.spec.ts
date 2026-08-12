import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { container } from "../../../../src/container/DIContainer.js";
import { METRICS_SERVICE_TOKEN } from "../../../../src/observability/contracts/MetricsService.js";
import {
  TRACER_SERVICE_TOKEN,
  SpanKind,
  SpanStatusCode,
} from "../../../../src/observability/contracts/TracerService.js";
import { Trace } from "../../../../src/observability/decorators/Trace.js";

describe("Decorador @Trace", () => {
  let mockSpan: any;
  let startSpanMock: any;

  // Mock metrics
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

  function createFreshSpan() {
    return {
      spanId: "span-test",
      traceId: "trace-test",
      name: "",
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
      addEvent: vi.fn(),
      recordException: vi.fn(),
      setStatus: vi.fn(),
      end: vi.fn(),
    };
  }

  function registerTracer() {
    mockSpan = createFreshSpan();
    startSpanMock = vi.fn().mockReturnValue(mockSpan);

    container.registerInstance(TRACER_SERVICE_TOKEN, {
      startSpan: startSpanMock,
      startActiveSpan: vi.fn((_name, fn) => fn(mockSpan)),
      endSpan: vi.fn(),
      inject: vi.fn(),
      extract: vi.fn(),
      getActiveSpan: vi.fn(),
      setBaggage: vi.fn(),
      getBaggage: vi.fn(),
      getAllBaggage: vi.fn().mockReturnValue({}),
      clearBaggage: vi.fn(),
      isEnabled: vi.fn().mockReturnValue(true),
      shutdown: vi.fn(),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    registerTracer();
    container.registerInstance(METRICS_SERVICE_TOKEN, mockMetrics);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Ejecucion del span", () => {
    it("Deberia crear un span al inicio y cerrarlo al final (sincrono)", () => {
      class TestService {
        @Trace("test.operation")
        syncMethod() {
          return "resultado";
        }
      }

      const service = new TestService();
      const result = service.syncMethod();

      expect(result).toBe("resultado");
      expect(startSpanMock).toHaveBeenCalledTimes(1);
      expect(startSpanMock).toHaveBeenCalledWith(
        "test.operation",
        expect.objectContaining({ kind: SpanKind.INTERNAL }),
      );
      expect(mockSpan.setStatus).toHaveBeenCalledWith(SpanStatusCode.OK);
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });

    it("Deberia crear un span al inicio y cerrarlo al final (asincrono)", async () => {
      class TestService {
        @Trace("test.async")
        async asyncMethod() {
          await Promise.resolve();
          return "resultado-async";
        }
      }

      const service = new TestService();
      const result = await service.asyncMethod();

      expect(result).toBe("resultado-async");
      expect(startSpanMock).toHaveBeenCalledTimes(1);
      expect(mockSpan.setStatus).toHaveBeenCalledWith(SpanStatusCode.OK);
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });
  });

  describe("Manejo de errores", () => {
    it("Deberia registrar la excepcion y marcar el span como ERROR (sincrono)", () => {
      class TestService {
        @Trace("test.error")
        syncError() {
          throw new Error("BOOM sincrono");
        }
      }

      const service = new TestService();

      expect(() => service.syncError()).toThrow("BOOM sincrono");
      expect(mockSpan.recordException).toHaveBeenCalledTimes(1);
      expect(mockSpan.setStatus).toHaveBeenCalledWith(
        SpanStatusCode.ERROR,
        "BOOM sincrono",
      );
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });

    it("Deberia registrar la excepcion y marcar el span como ERROR (asincrono)", async () => {
      class TestService {
        @Trace("test.asyncError")
        async asyncError() {
          await Promise.resolve();
          throw new Error("BOOM asincrono");
        }
      }

      const service = new TestService();

      await expect(service.asyncError()).rejects.toThrow("BOOM asincrono");
      expect(mockSpan.recordException).toHaveBeenCalledTimes(1);
      expect(mockSpan.setStatus).toHaveBeenCalledWith(
        SpanStatusCode.ERROR,
        "BOOM asincrono",
      );
      expect(mockSpan.end).toHaveBeenCalledTimes(1);
    });
  });

  describe("Atributos del span", () => {
    it("Deberia incluir code.function y code.namespace automaticamente", () => {
      class MyCoolService {
        @Trace()
        doSomething() {
          return true;
        }
      }

      const service = new MyCoolService();
      service.doSomething();

      const callArgs = startSpanMock.mock.calls[0][1];
      expect(callArgs).toBeDefined();
      expect(callArgs.attributes["code.function"]).toBe("doSomething");
      expect(callArgs.attributes["code.namespace"]).toBeDefined();
    });

    it("Deberia aceptar atributos personalizados en options", () => {
      class TestService {
        @Trace({
          name: "custom.name",
          attributes: { "business.operation": "create", team: "backend" },
        })
        customMethod() {
          return 42;
        }
      }

      const service = new TestService();
      service.customMethod();

      const callArgs = startSpanMock.mock.calls[0][1];
      expect(callArgs.attributes["business.operation"]).toBe("create");
      expect(callArgs.attributes.team).toBe("backend");
    });

    it("Deberia usar SpanKind cuando se especifica", () => {
      class TestService {
        @Trace({ name: "db.insert", kind: SpanKind.CLIENT })
        dbMethod() {
          return "ok";
        }
      }

      const service = new TestService();
      service.dbMethod();

      const callArgs = startSpanMock.mock.calls[0][1];
      expect(callArgs.kind).toBe(SpanKind.CLIENT);
    });
  });

  describe("Fallback sin tracer", () => {
    it("Deberia ejecutar el metodo normalmente si el tracer no esta disponible", () => {
      container.registerInstance(TRACER_SERVICE_TOKEN, {
        isEnabled: () => false,
        startSpan: vi.fn(),
        startActiveSpan: vi.fn(),
        endSpan: vi.fn(),
        inject: vi.fn(),
        extract: vi.fn(),
        getActiveSpan: vi.fn(),
        setBaggage: vi.fn(),
        getBaggage: vi.fn(),
        getAllBaggage: vi.fn().mockReturnValue({}),
        clearBaggage: vi.fn(),
        shutdown: vi.fn(),
      });

      class TestService {
        @Trace("fallback.test")
        method() {
          return "fallback-ok";
        }
      }

      const service = new TestService();
      const result = service.method();

      expect(result).toBe("fallback-ok");
    });
  });

  describe("Validacion del decorador", () => {
    it("Deberia lanzar error si se aplica a algo que no es un metodo", () => {
      const applyToClass = () => {
        const decorator = Trace();
        decorator({} as any, { kind: "class" } as any);
      };

      expect(applyToClass).toThrow(
        "@Trace solo puede ser aplicado a métodos de clase",
      );
    });
  });
});
