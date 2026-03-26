import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from "vitest";

import { container } from "../../../src/container/DIContainer.js";
import { Benchmark } from "../../../src/logger/benchmark.decorator.js";
import { getLogger } from "../../../src/logger/logger.factory.js";
import {
  DefaultConsoleLogger,
  LOGGER_TOKEN,
  type LoggerContract,
} from "../../../src/logger/LoggerContract.js";

describe("Sistema de Logs y Rendimiento (Logger & @Benchmark)", () => {
  // Variable para controlar el tiempo simulado en los tests de @Benchmark
  let currentTime = 0;
  let perfSpy: MockInstance;
  let consoleSpies: Record<string, MockInstance>;

  beforeEach(() => {
    // Mockeamos performance.now para controlar el tiempo en los tests de @Benchmark
    currentTime = 0;
    perfSpy = vi
      .spyOn(performance, "now")
      .mockImplementation(() => currentTime);

    // Mockeamos los métodos de console para espiar las llamadas sin imprimir realmente en la consola durante los tests
    consoleSpies = {
      info: vi.spyOn(console, "info").mockImplementation(() => {}), // Evitamos que los logs reales se impriman durante los tests y nos quedamos solo con la capacidad de espiar las llamadas
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
    };
  });

  // Restauramos los mocks después de cada test para evitar interferencias entre tests
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Implementación por Defecto (DefaultConsoleLogger)", () => {
    it("Deberia invocar los métodos nativos de console con los prefijos correctos", () => {
      const logger = new DefaultConsoleLogger();
      const ctx = { user: "Angel" };

      logger.info("Test Info", ctx);
      // Validamos que console.info haya sido llamado con el mensaje formateado y el contexto correcto
      expect(consoleSpies.info).toHaveBeenCalledWith(
        "🔵 [INFO]: Test Info",
        ctx,
      );

      logger.warn("Test Warn", ctx);
      // Validamos que console.warn haya sido llamado con el mensaje formateado y el contexto correcto
      expect(consoleSpies.warn).toHaveBeenCalledWith(
        "🟠 [WARN]: Test Warn",
        ctx,
      );

      logger.error("Test Error", ctx);
      // Validamos que console.error haya sido llamado con el mensaje formateado y el contexto correcto
      expect(consoleSpies.error).toHaveBeenCalledWith(
        "🔴 [ERROR]: Test Error",
        ctx,
      );

      logger.debug("Test Debug", ctx);
      // Validamos que console.debug haya sido llamado con el mensaje formateado y el contexto correcto
      expect(consoleSpies.debug).toHaveBeenCalledWith(
        "🟣 [DEBUG]: Test Debug",
        ctx,
      );

      logger.fatal("Test Fatal", ctx);
      // Validamos que console.error haya sido llamado con el mensaje formateado y el contexto correcto para fatal
      expect(consoleSpies.error).toHaveBeenCalledWith(
        "💥 [FATAL]: Test Fatal",
        ctx,
      );
    });

    it("Deberia manejar mensajes sin contexto sin imprimir undefined", () => {
      const logger = new DefaultConsoleLogger();
      logger.info("Solo mensaje");
      expect(consoleSpies.info).toHaveBeenCalledWith(
        "🔵 [INFO]: Solo mensaje",
        "",
      );
    });
  });

  describe("Factory de Logger (getLogger)", () => {
    it("Deberia retornar el fallback (DefaultConsoleLogger) si el token no está registrado en el contenedor", () => {
      // Como no hemos registrado LOGGER_TOKEN en el DIContainer, esto debe fallar internamente y usar el fallback
      const logger = getLogger();

      expect(logger).toBeDefined();
      expect(logger).toBeInstanceOf(DefaultConsoleLogger);
      // Validamos que haya lanzado el warning avisando al desarrollador de la implementación por defecto
      expect(consoleSpies.warn).toHaveBeenCalled();

      // ! Es algo extra xd pero aseguramos que el mensaje de advertencia sea claro y contenga el prefijo
      // ! del sistema de logging default para que los desarrolladores lo identifiquen fácilmente en la consola.
      // ! De esa forma se entiende claramente que el log proviene de la implementacion default
      const warningMessage = consoleSpies.warn.mock.calls[0][0];
      expect(warningMessage).toContain("[FastifyKit Logger]");
    });

    it("Deberia retornar la instancia personalizada si está registrada en el contenedor", () => {
      // Creamos una clase personalizada que implementa LoggerContract para usarla en el test
      class CustomLogger implements LoggerContract {
        info() {
          /* Empty method */
        }
        warn() {
          /* Empty method */
        }
        error() {
          /* Empty method */
        }
        debug() {
          /* Empty method */
        }
        fatal() {
          /* Empty method */
        }
      }

      const customInstance = new CustomLogger();

      // Registramos nuestra instancia en el contenedor usando el TOKEN definido en LoggerContract
      container.registerInstance(LOGGER_TOKEN, customInstance);

      // Ahora al llamar a getLogger, debería retornar nuestra instancia personalizada en lugar del DefaultConsoleLogger
      const logger = getLogger();

      expect(logger).toBeDefined();
      expect(logger).toBe(customInstance);
      expect(logger).not.toBeInstanceOf(DefaultConsoleLogger);
    });
  });

  describe("Decorador @Benchmark", () => {
    /*
     * NOTA (Mocking de performance.now):
     * * En lugar de usar temporizadores asíncronos reales que harían la suite lenta y propensa a fallos (Flaky),
     * * controlamos la variable `currentTime` manualmente. Esto garantiza que el test se ejecute en 0ms
     * * reales, pero simule perfectamente el paso del tiempo para la lógica del decorador.
     */
    class TestService {
      @Benchmark(100)
      syncTask(delay: number) {
        currentTime += delay; // Simulamos que el tiempo pasó
        return "sync-done";
      }

      @Benchmark(100)
      async asyncTask(delay: number, fail = false) {
        currentTime += delay;
        await Promise.resolve();
        if (fail) throw new Error("Async Error");
        return "async-done";
      }
    }

    // Variables para la instancia de servicio y el spy del logger
    let service: TestService;
    let loggerWarnSpy: MockInstance;

    beforeEach(() => {
      service = new TestService();
      // Espiamos el logger real que devuelve getLogger para ver si @Benchmark lo llama
      const logger = getLogger();
      loggerWarnSpy = vi.spyOn(logger, "warn");
    });

    it("No deberia registrar advertencias si la tarea síncrona es rápida (< 100ms)", () => {
      const result = service.syncTask(50); // Tarda 50ms

      expect(result).toBeDefined();
      expect(result).toBe("sync-done");
      expect(loggerWarnSpy).not.toHaveBeenCalled(); // No debe registrar advertencia porque el tiempo simulado es menor al umbral
    });

    it("Deberia registrar advertencia si la tarea síncrona es lenta (> 100ms)", () => {
      const result = service.syncTask(150); // Tarda 150ms

      expect(result).toBeDefined();
      expect(result).toBe("sync-done");
      expect(loggerWarnSpy).toHaveBeenCalledTimes(1);
      expect(loggerWarnSpy.mock.calls[0][0]).toContain(
        "[Benchmark] syncTask tardo: 150.00ms",
      );
    });

    it("No deberia registrar advertencias si la promesa asíncrona es rápida", async () => {
      const result = await service.asyncTask(50);

      expect(result).toBeDefined();
      expect(result).toBe("async-done");
      expect(loggerWarnSpy).not.toHaveBeenCalled();
    });

    it("Deberia registrar advertencia si la promesa asíncrona es lenta", async () => {
      const result = await service.asyncTask(250);

      expect(result).toBe("async-done");
      expect(loggerWarnSpy).toHaveBeenCalledTimes(1);
      expect(loggerWarnSpy.mock.calls[0][0]).toContain(
        "[Benchmark] asyncTask tardo: 250.00ms",
      );
    });

    it("Deberia registrar advertencia y propagar el error si una promesa lenta falla", async () => {
      // Ejecutamos una tarea que tarda 300ms y luego explota
      await expect(service.asyncTask(300, true)).rejects.toThrow("Async Error");

      // Validamos que el benchmark igual calculó el tiempo a pesar del error y registró la advertencia correspondiente
      expect(loggerWarnSpy).toHaveBeenCalledTimes(1);
      expect(loggerWarnSpy.mock.calls[0][0]).toContain(
        "[Benchmark] asyncTask tardo: 300.00ms",
      );
    });
  });

  describe("Validaciones Críticas", () => {
    it("Deberia lanzar un error si @Benchmark se aplica a algo que no es un método", () => {
      expect(() => {
        class InvalidUsage {
          declare public dummy: unknown;
          constructor() {
            const benchFn = Benchmark(100);
            benchFn(undefined as any, { kind: "field", name: "bad" } as any);
          }
        }
        new InvalidUsage();
      }).toThrow();
    });
  });
});
