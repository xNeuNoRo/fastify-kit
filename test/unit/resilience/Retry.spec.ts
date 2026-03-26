import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { Retry } from "../../../src/resilience/retry.decorator.js";

/**
 * Fuerza al motor de Node.js V8 a resolver todas las microtareas anidadas (cadenas de async/await)
 * en el Event Loop garantizando que los setTimeouts internos sean registrados antes de avanzar el reloj.
 */
const flushPromises = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

describe("Sistema de Resiliencia (@Retry con Backoff Exponencial)", () => {
  // Configuramos los temporizadores falsos para controlar el tiempo en las pruebas
  beforeEach(() => {
    vi.useFakeTimers();
  });

  // Restauramos los temporizadores reales después de cada prueba para evitar efectos secundarios en otras pruebas
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Clase dummy para probar el decorador @Retry con diferentes escenarios de fallo y éxito
  class UnstableService {
    // Variables para contar cuántas veces se llamó a cada método, para verificar los reintentos
    public asyncCallCount = 0;
    public syncCallCount = 0;
    public implicitCallCount = 0;
    public failCallCount = 0;

    // Método asíncrono puro que falla 2 veces y triunfa a la 3ra
    @Retry(3, 100) // Intentos: 3, Base Delay: 100ms
    async flakyAsync() {
      this.asyncCallCount++;
      await Promise.resolve(); // Simula una operación asíncrona
      if (this.asyncCallCount < 3) {
        throw new Error("Fallo asíncrono de red");
      }
      return "Éxito Asíncrono";
    }

    // Método síncrono que falla 2 veces y triunfa a la 3ra
    @Retry(3, 100)
    flakySync() {
      this.syncCallCount++;
      if (this.syncCallCount < 3) {
        throw new Error("Fallo de cálculo síncrono");
      }
      return "Éxito Síncrono";
    }

    // Método engañoso (no tiene 'async' pero devuelve Promesa)
    @Retry(3, 100)
    flakyImplicitPromise() {
      this.implicitCallCount++;
      if (this.implicitCallCount < 3) {
        return Promise.reject(new Error("Fallo de promesa implícita"));
      }
      return Promise.resolve("Éxito Implícito");
    }

    // Método asíncrono que SIEMPRE falla (Exhaustión)
    @Retry(3, 100)
    async failingAsync() {
      this.failCallCount++;
      await Promise.resolve(); // Simula una operación asíncrona
      throw new Error("Base de datos inalcanzable");
    }

    // Método síncrono que SIEMPRE falla (Exhaustión)
    @Retry(3, 100)
    failingSync() {
      this.syncCallCount++;
      throw new Error("Fallo síncrono fatal");
    }

    // Método de promesa implícita que SIEMPRE falla (Exhaustión)
    @Retry(3, 100)
    failingImplicitPromise() {
      this.implicitCallCount++;
      return Promise.reject(new Error("Fallo implícito fatal"));
    }
  }

  describe("Métodos Síncronos", () => {
    it("Debería reintentar instantáneamente (sin sleep) y devolver el resultado si eventualmente triunfa", () => {
      const service = new UnstableService();

      // Se ejecuta de inmediato. Falla 2 veces y la 3ra funciona.
      const result = service.flakySync();

      expect(result).toBeDefined();
      expect(result).toBe("Éxito Síncrono");

      // Comprobamos que sí se intentó 3 veces, aunque no hubo delay entre intentos
      expect(service.syncCallCount).toBe(3);
    });

    it("Debería lanzar el último error si un método síncrono agota todos los intentos (Exhaustión)", () => {
      const service = new UnstableService();

      // Al ser síncrono puro, explota inmediatamente en la misma línea de ejecución
      expect(() => service.failingSync()).toThrow("Fallo síncrono fatal");

      // Validamos que efectivamente haya iterado las 3 veces en el ciclo while antes de rendirse
      expect(service.syncCallCount).toBe(3);
    });
  });

  describe("Métodos Asíncronos (AsyncFunction)", () => {
    it("Debería aplicar backoff exponencial, fallar 2 veces y resolver a la tercera", async () => {
      const service = new UnstableService();

      // Disparamos la promesa (Aún no hacemos await)
      const promise = service.flakyAsync();

      // Intento 1: Falla. Se calcula el delay: 100 * (2^0) = 100ms
      await flushPromises();
      vi.advanceTimersByTime(100);

      // Intento 2: Falla. Se calcula el delay: 100 * (2^1) = 200ms
      await flushPromises();
      vi.advanceTimersByTime(200);

      // Intento 3: Triunfa. No hay más delays, se resuelve inmediatamente.
      await flushPromises();

      // Comprobamos el resultado final
      const result = await promise;
      expect(result).toBe("Éxito Asíncrono");
      expect(service.asyncCallCount).toBe(3);
    });

    it("Debería lanzar el último error si se agotan todos los intentos (Exhaustión)", async () => {
      const service = new UnstableService();

      const promise = service.failingAsync();

      // Avanzamos el tiempo para los 2 reintentos posteriores al primer fallo
      // Intento 1 (falla) espera 100ms
      await flushPromises();
      vi.advanceTimersByTime(100);

      // Intento 2 (falla) espera 200ms
      await flushPromises();
      vi.advanceTimersByTime(200);

      // Intento 3 (falla) Lanza el error final
      await flushPromises();

      // Comprobamos que explotó con el error original
      await expect(promise).rejects.toThrow("Base de datos inalcanzable");
      expect(service.failCallCount).toBe(3); // Se rindió después de 3 intentos
    });
  });

  describe("Manejo de Promesas Implícitas (Fallback)", () => {
    it("Debería interceptar promesas retornadas por métodos síncronos y aplicarles backoff", async () => {
      const service = new UnstableService();

      const promise = service.flakyImplicitPromise();

      // Intento 1 (Falla de promesa) espera 100ms
      await flushPromises();
      vi.advanceTimersByTime(100);

      // Intento 2 (Falla de promesa) espera 200ms
      await flushPromises();
      vi.advanceTimersByTime(200);

      await flushPromises();

      // Intento 3: Resuelve la promesa implícita
      const result = await promise;
      expect(result).toBe("Éxito Implícito");
      expect(service.implicitCallCount).toBe(3);
    });

    it("Debería aplicar backoff y lanzar el último error si una promesa implícita agota los intentos (Exhaustión)", async () => {
      const service = new UnstableService();

      const promise = service.failingImplicitPromise();

      // Intento 1 (falla de inmediato y activa el sleep) espera 100ms
      await flushPromises();
      vi.advanceTimersByTime(100);

      // Intento 2 (falla) espera 200ms
      await flushPromises();
      vi.advanceTimersByTime(200);

      // Intento 3 (falla y agota intentos)
      await flushPromises();

      await expect(promise).rejects.toThrow("Fallo implícito fatal");
      expect(service.implicitCallCount).toBe(3);
    });
  });

  describe("Protección del Decorador", () => {
    it("Debería lanzar un error si @Retry se aplica a algo que no es un método", () => {
      expect(() => {
        class InvalidUsage {
          declare public dummy: unknown;
          constructor() {
            const retryFn = Retry(3, 1000);
            retryFn(undefined as any, { kind: "field", name: "bad" } as any);
          }
        }
        new InvalidUsage();
      }).toThrow();
    });
  });
});
