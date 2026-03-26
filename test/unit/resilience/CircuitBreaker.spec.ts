import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";

import { getLogger } from "../../../src/logger/logger.factory.js";
import { CircuitBreaker } from "../../../src/resilience/circuit-breaker.decorator.js";

describe("Sistema de Resiliencia (@CircuitBreaker)", () => {
  // Mocks para espiar los logs sin ensuciar la consola durante las pruebas,
  // permitiendo verificar los cambios de estado del circuito breaker a través de los mensajes de log.
  let loggerInfoSpy: MockInstance;
  let loggerWarnSpy: MockInstance;
  let loggerErrorSpy: MockInstance;
  let currentTime: number;

  beforeEach(() => {
    // Fijamos una fecha y hora específica para tener un control total sobre
    // el tiempo en las pruebas, especialmente para simular el paso del tiempo en el estado HALF_OPEN.
    currentTime = new Date("2026-01-01T00:00:00.000Z").getTime();

    // Mockeamos Date.now() para que siempre retorne el tiempo controlado por currentTime,
    // lo que nos permitirá avanzar el tiempo a voluntad durante las pruebas.
    vi.spyOn(Date, "now").mockImplementation(() => currentTime);

    // Espiamos los métodos de log para verificar que se emiten los mensajes correctos en cada estado del circuito breaker.
    const logger = getLogger();
    loggerInfoSpy = vi.spyOn(logger, "info").mockImplementation(() => {}); // Dejamos la impl. vacia para evitar logs reales
    loggerWarnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    loggerErrorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
  });

  // Luego de cada prueba, restauramos los mocks para evitar interferencias
  // entre pruebas y asegurarnos de que cada prueba tenga un entorno limpio.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Creamos una clase de servicio aislada para cada prueba, decorando su método con @CircuitBreaker.
  // Esto garantiza que cada prueba tenga su propio estado de circuito breaker independiente, evitando efectos colaterales entre pruebas.
  const createIsolatedService = () => {
    class PaymentService {
      public shouldFail = false;
      public executeCount = 0;

      @CircuitBreaker(3, 10000)
      async processPayment() {
        this.executeCount++;
        await Promise.resolve(); // Simula una operación asíncrona, como una llamada a un servicio externo
        if (this.shouldFail) {
          throw new Error("Fallo en la pasarela de pago");
        }
        return "Pago Exitoso";
      }
    }
    return new PaymentService();
  };

  describe("Estado: CLOSED (Operación Normal)", () => {
    it("Debería permitir la ejecución si no hay fallos", async () => {
      const service = createIsolatedService();

      const result1 = await service.processPayment();
      const result2 = await service.processPayment();

      expect(result1).toBe("Pago Exitoso");
      expect(result2).toBe("Pago Exitoso");
      expect(service.executeCount).toBe(2);
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });

    it("Debería tolerar fallos por debajo del umbral sin abrir el circuito", async () => {
      const service = createIsolatedService();
      service.shouldFail = true;

      // Fallo 1
      await expect(service.processPayment()).rejects.toThrow(
        "Fallo en la pasarela",
      );
      // Fallo 2
      await expect(service.processPayment()).rejects.toThrow(
        "Fallo en la pasarela",
      );

      // El circuito sigue CLOSED porque el umbral es 3. La ejecución real cuenta: 2
      expect(service.executeCount).toBe(2);
      // Aún no se emite el log de circuito abierto
      expect(loggerErrorSpy).not.toHaveBeenCalled();
    });
  });

  describe("Estado: OPEN (Protección Activa)", () => {
    it("Debería abrir el circuito al alcanzar el umbral y bloquear llamadas subsecuentes al instante", async () => {
      const service = createIsolatedService();
      service.shouldFail = true;

      // Llegamos al límite (3 fallos)
      await expect(service.processPayment()).rejects.toThrow();
      await expect(service.processPayment()).rejects.toThrow();
      await expect(service.processPayment()).rejects.toThrow();

      // Verificamos que efectivamente se haya logueado el error de circuito abierto
      expect(loggerErrorSpy).toHaveBeenCalledTimes(1);

      // Intento 4: Debería ser rechazado INMEDIATAMENTE por el Circuit Breaker, sin ejecutar la lógica
      await expect(service.processPayment()).rejects.toThrow();

      // Verificación clave: La lógica real de negocio solo se ejecutó 3 veces, el 4to intento fue bloqueado en la puerta
      expect(service.executeCount).toBe(3);
    });
  });

  describe("Estado: HALF_OPEN (Recuperación Exitosa)", () => {
    it("Debería probar la conexión y CERRAR el circuito si el servicio se recupera", async () => {
      const service = createIsolatedService();
      service.shouldFail = true;

      // Rompemos el circuito (3 fallos)
      await expect(service.processPayment()).rejects.toThrow();
      await expect(service.processPayment()).rejects.toThrow();
      await expect(service.processPayment()).rejects.toThrow();

      // Viajamos en el tiempo 11 segundos al futuro (pasando el castigo de 10s)
      currentTime += 11000;

      // Arreglamos el servicio de terceros
      service.shouldFail = false;

      // Esta llamada entrará en HALF_OPEN, se ejecutará y tendrá éxito
      const result = await service.processPayment();

      expect(result).toBeDefined();
      expect(result).toBe("Pago Exitoso");

      // Verificamos que se hayan llamado los logs de prueba en HALF_OPEN y de restauración del servicio
      expect(loggerWarnSpy).toHaveBeenCalled();
      expect(loggerInfoSpy).toHaveBeenCalled();

      // Validamos que el circuito volvió a la normalidad simulando otro fallo
      // Como el circuito se cerró y el contador se reinició a 0, este primer fallo no debería abrirlo
      service.shouldFail = true;
      await expect(service.processPayment()).rejects.toThrow(
        "Fallo en la pasarela de pago",
      );
    });
  });

  describe("Estado: HALF_OPEN (Recaída por fallo persistente)", () => {
    it("Debería volver a ABRIR el circuito inmediatamente si la prueba falla", async () => {
      const service = createIsolatedService();
      service.shouldFail = true;

      // Rompemos el circuito
      await expect(service.processPayment()).rejects.toThrow();
      await expect(service.processPayment()).rejects.toThrow();
      await expect(service.processPayment()).rejects.toThrow();

      // Viajamos 11 segundos al futuro
      currentTime += 11000;

      // El servicio SIGUE roto (shouldFail = true)

      // Esta llamada entra en HALF_OPEN, falla y vuelve a abrir el circuito (estableciendo 10s más de castigo)
      await expect(service.processPayment()).rejects.toThrow(
        "Fallo en la pasarela de pago",
      );

      // Validamos que se bloquee inmediatamente en la siguiente llamada sin esperar 3 fallos
      await expect(service.processPayment()).rejects.toThrow();

      // La lógica real solo debió ejecutarse 4 veces (3 iniciales + 1 de prueba en HALF_OPEN)
      expect(service.executeCount).toBe(4);
    });
  });

  describe("Protección de Entorno", () => {
    it("Debería lanzar un error si se aplica el decorador a un campo o clase", () => {
      expect(() => {
        class InvalidUsage {
          declare public dummy: unknown;
          constructor() {
            const cbFn = CircuitBreaker(3, 10000);
            cbFn(undefined as any, { kind: "field", name: "bad" } as any);
          }
        }
        new InvalidUsage();
      }).toThrow();
    });
  });
});
