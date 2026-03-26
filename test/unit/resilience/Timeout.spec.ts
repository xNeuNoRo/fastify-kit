import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { Timeout } from "../../../src/resilience/timeout.decorator.js";

describe("Sistema de Resiliencia (@Timeout)", () => {
  // Configuramos los temporizadores falsos para controlar el tiempo en las pruebas
  beforeEach(() => {
    vi.useFakeTimers();
  });

  // Restauramos los temporizadores reales después de cada prueba para evitar efectos secundarios en otras pruebas
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Clases dummy para probar el decorador @Timeout
  class NetworkService {
    @Timeout(100)
    async fastOperation() {
      // Simula una operación que tarda 50ms (Debería pasar)
      return new Promise((resolve) => setTimeout(() => resolve("Éxito"), 50));
    }

    @Timeout(100)
    async slowOperation() {
      // Simula una operación que tarda 200ms (Debería dar Timeout)
      return new Promise((resolve) =>
        setTimeout(() => resolve("Muy lento"), 200),
      );
    }

    @Timeout(100)
    async failingOperation() {
      // Simula una operación que falla rápido por un error de negocio
      return new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Error original de Base de Datos")),
          10,
        ),
      );
    }

    @Timeout(100)
    syncOperation() {
      // Un método síncrono ignora el timeout por diseño
      return "Síncrono";
    }
  }

  describe("Operaciones a tiempo", () => {
    it("Debería resolver correctamente si la promesa termina ANTES del timeout", async () => {
      const service = new NetworkService();

      // Disparamos la promesa
      const promise = service.fastOperation();

      // Avanzamos el tiempo 50ms (lo que tarda la operación en terminar)
      vi.advanceTimersByTime(50);

      // Verificamos que se resolvió con éxito
      const result = await promise;
      expect(result).toBeDefined();
      expect(result).toBe("Éxito");
    });

    it("Debería retornar inmediatamente el resultado si el método es síncrono", () => {
      const service = new NetworkService();

      // No hay promesas aquí, se ejecuta de inmediato
      const result = service.syncOperation();

      expect(result).toBeDefined();
      expect(result).toBe("Síncrono");
    });
  });

  describe("Manejo de Errores y Timeouts", () => {
    it("Debería rechazar la promesa con un error si excede el tiempo límite", async () => {
      const service = new NetworkService();

      // Disparamos la promesa lenta
      const promise = service.slowOperation();

      // Avanzamos el tiempo 101ms (1 milisegundo por encima del límite de 100ms)
      vi.advanceTimersByTime(101);

      // Verificamos que se rechazó con un error de timeout
      await expect(promise).rejects.toThrow();
    });

    it("Debería respetar y propagar el error original si falla ANTES del timeout", async () => {
      const service = new NetworkService();

      // Disparamos la promesa que falla
      const promise = service.failingOperation();

      // Avanzamos el tiempo 10ms (el momento en el que lanza el error original)
      vi.advanceTimersByTime(10);

      // Verificamos que NO es un error de timeout, sino el error de negocio
      await expect(promise).rejects.toThrow("Error original de Base de Datos");
    });
  });

  describe("Protección del Decorador", () => {
    it("Debería lanzar un error si @Timeout se aplica a algo que no es un método", () => {
      expect(() => {
        class InvalidUsage {
          declare public dummy: unknown;
          constructor() {
            const timeoutFn = Timeout(5000);
            timeoutFn(undefined as any, { kind: "field", name: "bad" } as any);
          }
        }
        new InvalidUsage();
      }).toThrow();
    });
  });
});
