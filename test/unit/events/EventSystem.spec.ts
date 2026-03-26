import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";

import { container } from "../../../src/container/DIContainer.js";
import { getEventBus } from "../../../src/events/eventbus.factory.js";
import {
  DefaultEventBus,
  EVENT_BUS_TOKEN,
} from "../../../src/events/EventBus.js";
import { OnEvent } from "../../../src/events/on-event.decorator.js";
import { OnceEvent } from "../../../src/events/once-event.decorator.js";

describe("Sistema de Eventos (EventBus & Decoradores)", () => {
  // Variables para espiar los logs de error y warning
  let loggerErrorSpy: MockInstance;
  let loggerWarnSpy: MockInstance;

  // Espiamos los logs (consola default) para verificar que se están llamando correctamente en caso de errores o warnings
  beforeEach(() => {
    container.clearAll();
    loggerErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    loggerWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  // Restauramos los mocks después de cada test para evitar interferencias entre pruebas
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Implementación Nativa (DefaultEventBus)", () => {
    it("Debería registrar un listener y recibir el payload al emitir", () => {
      const bus = new DefaultEventBus();
      const listener = vi.fn((payload) => {
        expect(payload).toBeDefined();
        expect(payload).toEqual({ id: 1 }); // Validamos que el payload recibido es el esperado
        expect(payload.id).toBe(1);
      });

      bus.on("test.event", listener);
      bus.emit("test.event", { id: 1 });

      // Validamos que el listener fue llamado exactamente una vez con el payload correcto
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ id: 1 });
    });

    it("Debería ejecutar un listener 'once' exactamente una vez", () => {
      const bus = new DefaultEventBus();
      const listener = vi.fn((payload) => {
        expect(payload).toBeDefined();
        expect(payload).toBe("intento 1");
      });

      bus.once("test.once", listener);
      bus.emit("test.once", "intento 1");
      bus.emit("test.once", "intento 2");

      // Validamos que el listener se ejecutó solo la primera vez con el payload correcto
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith("intento 1");
    });

    it("Debería poder remover un listener usando 'off'", () => {
      const bus = new DefaultEventBus();
      const listener = vi.fn();

      bus.on("test.off", listener);

      // Lo removemos inmediatamente para probar que no se ejecute al emitir
      bus.off("test.off", listener);
      bus.emit("test.off", "datos");

      // Validamos que el listener no fue llamado después de ser removido
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("Factory de Eventos (getEventBus)", () => {
    it("Debería retornar el fallback (DefaultEventBus) y loguear un warning si no está registrado una implementación en el DI", () => {
      // Como no hemos registrado el token en este test, debe saltar al catch del factory
      const bus = getEventBus();
      expect(bus).toBeInstanceOf(DefaultEventBus);
      // Se debe haber llamado dos veces ya que internamente este hace un fallback al logger default
      expect(loggerWarnSpy).toHaveBeenCalledTimes(2);
    });

    it("Debería retornar la instancia personalizada si está registrada en el contenedor DI", () => {
      class CustomBus extends DefaultEventBus {
        public isCustom = true;
      }

      const customInstance = new CustomBus();

      // Registramos nuestra instancia en el contenedor de dependencias
      container.registerInstance(EVENT_BUS_TOKEN, customInstance);

      const bus = getEventBus();

      expect(bus).toBe(customInstance);
      expect(bus).toBeInstanceOf(CustomBus);
      expect((bus as CustomBus).isCustom).toBe(true);
    });
  });

  describe("Decoradores de Suscripción (@OnEvent y @OnceEvent)", () => {
    it("Debería suscribir los métodos correctamente y procesar los eventos emitidos", () => {
      // Usamos el bus global que los decoradores van a interceptar
      const bus = getEventBus();

      class NotificationService {
        public regularCount = 0;
        public onceCount = 0;
        public lastPayload: any = null;

        @OnEvent("user.created")
        handleUserCreated(payload: any) {
          this.regularCount++;
          this.lastPayload = payload;
        }

        @OnceEvent("system.boot")
        handleSystemBoot(_payload: any) {
          this.onceCount++;
        }
      }

      const service = new NotificationService();

      // Emitimos el evento regular 3 veces
      bus.emit("user.created", { userId: 123 });
      bus.emit("user.created", { userId: 456 });
      bus.emit("user.created"); // Sin payload

      // Emitimos el evento once 3 veces
      bus.emit("system.boot", "arranque 1");
      bus.emit("system.boot", "arranque 2");
      bus.emit("system.boot", "arranque 3");

      // Validamos el @OnEvent
      expect(service.regularCount).toBe(3);
      expect(service.lastPayload).toBeUndefined(); // El último no tenía payload

      // Validamos el @OnceEvent
      expect(service.onceCount).toBe(1); // Solo debió ejecutarse a la primera emisión
    });
  });

  describe("Protección contra Excepciones en Eventos", () => {
    it("No debería colapsar el sistema si un listener lanza un error, sino que debe loguearlo", async () => {
      const bus = getEventBus();

      class FaultyService {
        @OnEvent("payment.failed")
        async handlePayment(_payload: any) {
          await Promise.resolve(); // Simulamos una operación asíncrona
          throw new Error("Base de datos caída al procesar evento");
        }

        @OnceEvent("payment.refund")
        handleRefund() {
          throw new Error("Error en reembolso único");
        }
      }

      // Registramos los eventos al instanciar la clase (gracias a los decoradores)
      new FaultyService();

      // Emitimos los eventos (esto no debe hacer explotar el test gracias al try/catch del decorador)
      bus.emit("payment.failed", { amount: 100 });
      bus.emit("payment.refund");

      // Obligamos al Event Loop a procesar todas las microtareas pendientes (Promesas)
      // usando un setTimeout de 0ms (Macrotarea) para que se ejecute al final de la fila.
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Confirmamos que se loguearon los errores correctamente (dos llamadas: una por cada evento que lanza error)
      expect(loggerErrorSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("Protección de los Decoradores (@OnEvent y @OnceEvent)", () => {
    it("Debería lanzar un error si @OnEvent o @OnceEvent se aplican a campos en lugar de métodos", () => {
      expect(() => {
        class InvalidOnEvent {
          declare public dummy: unknown;
          constructor() {
            const onEventFn = OnEvent("bad");
            onEventFn(undefined as any, { kind: "field", name: "bad" } as any);
          }
        }
        new InvalidOnEvent();
      }).toThrow();

      expect(() => {
        class InvalidOnceEvent {
          declare public dummy: unknown;
          constructor() {
            const onceEventFn = OnceEvent("bad");
            onceEventFn(
              undefined as any,
              { kind: "field", name: "bad" } as any,
            );
          }
        }
        new InvalidOnceEvent();
      }).toThrow();
    });
  });
});
