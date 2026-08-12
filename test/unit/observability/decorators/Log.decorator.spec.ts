import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { container } from "../../../../src/container/DIContainer.js";
import { LOGGER_TOKEN } from "../../../../src/logger/LoggerContract.js";
import { Log } from "../../../../src/observability/decorators/Log.js";

// Mock del logger
const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
};

describe("Decorador @Log", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    container.registerInstance(LOGGER_TOKEN, mockLogger);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Log de entrada", () => {
    it("Deberia registrar un log al entrar al metodo con el mensaje y nivel", () => {
      class TestService {
        @Log({ level: "info", message: "Creando recurso" })
        syncMethod() {
          return "ok";
        }
      }

      const service = new TestService();
      service.syncMethod();

      expect(mockLogger.info).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith(
        "Creando recurso",
        expect.objectContaining({
          class: expect.any(String),
          method: "syncMethod",
        }),
      );
    });

    it("Deberia soportar diferentes niveles de log", () => {
      class TestService {
        @Log({ level: "warn", message: "Advertencia importante" })
        method() {
          return true;
        }
      }

      const service = new TestService();
      service.method();

      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Advertencia importante",
        expect.any(Object),
      );
    });
  });

  describe("Interpolacion de mensajes", () => {
    it("Deberia incluir contexto estatico en el log", () => {
      class TestService {
        @Log({ level: "info", message: "Test", context: { team: "backend" } })
        method() {
          return true;
        }
      }

      const service = new TestService();
      service.method();

      const callCtx = mockLogger.info.mock.calls[0][1];
      expect(callCtx.team).toBe("backend");
    });
  });

  describe("Log de salida", () => {
    it("Deberia registrar un log de completado si logOutput es true", () => {
      class TestService {
        @Log({ level: "info", message: "Operacion", logOutput: true })
        method() {
          return "resultado";
        }
      }

      const service = new TestService();
      service.method();

      expect(mockLogger.info).toHaveBeenCalledTimes(2);
      expect(mockLogger.info.mock.calls[1][0]).toContain("completado");
      expect(mockLogger.info.mock.calls[1][1]).toEqual(
        expect.objectContaining({
          durationMs: expect.any(Number),
          output: expect.any(String),
        }),
      );
    });
  });

  describe("Log de error", () => {
    it("Deberia registrar un log de error si el metodo falla (por defecto)", () => {
      class TestService {
        @Log({ level: "error", message: "Operacion peligrosa" })
        dangerousMethod() {
          throw new Error("BOOM");
        }
      }

      const service = new TestService();

      expect(() => service.dangerousMethod()).toThrow("BOOM");
      expect(mockLogger.error).toHaveBeenCalledTimes(2);
      expect(mockLogger.error.mock.calls[1][0]).toContain("fallido");
      expect(mockLogger.error.mock.calls[1][1].error).toBeDefined();
      expect(mockLogger.error.mock.calls[1][1].error.message).toBe("BOOM");
    });

    it("Deberia incluir la duracion en el log de error", () => {
      class TestService {
        @Log({ level: "error", message: "Operacion" })
        method() {
          throw new Error("fail");
        }
      }

      const service = new TestService();

      expect(() => service.method()).toThrow("fail");
      expect(mockLogger.error.mock.calls[1][1]).toEqual(
        expect.objectContaining({
          durationMs: expect.any(Number),
        }),
      );
    });
  });

  describe("Fallback sin logger", () => {
    it("Deberia ejecutar el metodo normalmente usando un logger minimo", () => {
      container.registerInstance(LOGGER_TOKEN, {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
      });

      class TestService {
        @Log({ level: "info", message: "noop" })
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
        const decorator = Log({ level: "info", message: "test" });
        decorator({} as any, { kind: "class" } as any);
      };

      expect(applyToClass).toThrow(
        "@Log solo puede ser aplicado a métodos de clase",
      );
    });
  });
});
