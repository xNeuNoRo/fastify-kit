import * as fs from "node:fs/promises";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { DiskSpaceHealthIndicator } from "../../../src/health/indicators/DiskSpaceHealthIndicator.js";
import { EventLoopHealthIndicator } from "../../../src/health/indicators/EventLoopHealthIndicator.js";
import { HttpHealthIndicator } from "../../../src/health/indicators/HttpHealthIndicator.js";
import { MemoryHealthIndicator } from "../../../src/health/indicators/MemoryHealthIndicator.js";
import { PingHealthIndicator } from "../../../src/health/indicators/PingHealthIndicator.js";

describe("Health Indicators Integrados (Unitarios)", () => {
  // Antes de cada test, restauramos los mocks para evitar contaminación entre pruebas
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Indicador Integrado: PingHealthIndicator", () => {
    let indicator: PingHealthIndicator;

    // Usamos la clase real de PingHealthIndicator para probar su lógica interna
    beforeEach(() => {
      indicator = new PingHealthIndicator();
    });

    // Probamos el método check() con un callback exitoso y uno que lanza error
    it("Debería retornar 'up' y medir la latencia si el callback es exitoso", async () => {
      const result = await indicator.check("db", async () => {
        await Promise.resolve(); // Simulamos async
        return "Conexión OK";
      });

      expect(result.db.status).toBe("up");
      expect(result.db.latency).toBeDefined();
      expect(result.db.error).toBeUndefined();
    });

    it("Debería retornar 'down' y capturar el error si el callback falla", async () => {
      const result = await indicator.check("redis", async () => {
        await Promise.resolve(); // Simulamos async
        throw new Error("Timeout en Redis");
      });

      expect(result.redis.status).toBe("down");
      expect(result.redis.error).toBe("Timeout en Redis");
    });
  });

  describe("Indicador Integrado: HttpHealthIndicator", () => {
    let indicator: HttpHealthIndicator;
    let fetchMock: any;

    // Para probar HttpHealthIndicator, mockeamos globalThis.fetch para simular diferentes respuestas HTTP
    beforeEach(() => {
      indicator = new HttpHealthIndicator();
      // Creamos el mock y lo asignamos tanto a la variable local como al global
      fetchMock = vi.fn();
      globalThis.fetch = fetchMock;
    });

    it("Debería retornar 'up' si la API responde con el código esperado", async () => {
      // Simulamos una respuesta 200 OK directamente sobre nuestra variable mock
      fetchMock.mockResolvedValueOnce({ status: 200 } as Response);

      const result = await indicator.check("stripe", "https://api.stripe.com", {
        expectedStatus: 200,
      });

      // Validamos que el resultado es 'up' y que se midió la latencia
      expect(result.stripe.status).toBe("up");
      expect(result.stripe.latency).toBeDefined();
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.stripe.com",
        expect.any(Object),
      );
    });

    it("Debería retornar 'down' si la API responde con un código distinto", async () => {
      // Simulamos una respuesta 500 Internal Server Error
      fetchMock.mockResolvedValueOnce({ status: 500 } as Response);

      const result = await indicator.check("stripe", "https://api.stripe.com", {
        expectedStatus: 200,
      });

      // Validamos que el resultado es 'down' y que se reporta el error de código inesperado
      expect(result.stripe.status).toBe("down");
      expect(result.stripe.error).toContain("Expected status 200, got 500");
    });

    it("Debería retornar 'down' si el fetch lanza un error (Timeout/Abort)", async () => {
      // Simulamos un error de red o timeout
      fetchMock.mockRejectedValueOnce(new Error("The operation was aborted"));

      const result = await indicator.check("api", "https://lento.com");

      expect(result.api.status).toBe("down");
      expect(result.api.error).toContain("Timeout exceeded");
    });
  });

  describe("Indicador Integrado: MemoryHealthIndicator", () => {
    let indicator: MemoryHealthIndicator;

    beforeEach(() => {
      indicator = new MemoryHealthIndicator();

      // Mockeamos el uso de memoria para tener números predecibles
      // 100MB de Heap, 200MB de RSS
      vi.spyOn(process, "memoryUsage").mockReturnValue({
        heapUsed: 100 * 1024 * 1024,
        rss: 200 * 1024 * 1024,
      } as NodeJS.MemoryUsage);
    });

    it("Debería retornar 'up' si el Heap está por debajo del límite", async () => {
      const result = await indicator.checkHeap("memoria", 150); // Límite: 150MB, Uso: 100MB
      expect(result.memoria.status).toBe("up");
      expect(result.memoria.usedMB).toBe(100);
    });

    it("Debería retornar 'down' si el RSS supera el límite", async () => {
      const result = await indicator.checkRSS("rss", 150); // Límite: 150MB, Uso: 200MB
      expect(result.rss.status).toBe("down");
      expect(result.rss.error).toContain("RSS limit exceeded");
    });
  });

  describe("Indicador Integrado: DiskSpaceHealthIndicator", () => {
    let indicator: DiskSpaceHealthIndicator;

    beforeEach(() => {
      indicator = new DiskSpaceHealthIndicator();
    });

    it("Debería retornar 'up' si hay suficiente espacio libre", async () => {
      // Mockeamos fs.statfs para simular 1GB libre (1000 bloques de 1MB)
      vi.spyOn(fs, "statfs").mockResolvedValueOnce({
        bavail: 1000,
        bsize: 1024 * 1024,
      } as Awaited<ReturnType<typeof fs.statfs>>);

      const result = await indicator.check("disco", "/", 500); // Límite: 500MB, Libre: 1000MB

      expect(result.disco.status).toBe("up");
      expect(result.disco.freeMB).toBe(1000);
    });

    it("Debería retornar 'down' si hay poco espacio en disco", async () => {
      // Mockeamos fs.statfs para simular 100MB libres
      vi.spyOn(fs, "statfs").mockResolvedValueOnce({
        bavail: 100,
        bsize: 1024 * 1024,
      } as Awaited<ReturnType<typeof fs.statfs>>);

      const result = await indicator.check("disco", "/", 250); // Límite: 250MB, Libre: 100MB

      expect(result.disco.status).toBe("down");
      expect(result.disco.error).toContain("Low disk space");
    });
  });

  describe("Indicador Integrado: EventLoopHealthIndicator", () => {
    let indicator: EventLoopHealthIndicator;

    beforeEach(() => {
      indicator = new EventLoopHealthIndicator();
    });

    it("Debería retornar 'up' si el hilo principal no está bloqueado", async () => {
      // Para probar el Event Loop sin mocks raros de tiempo, le damos un umbral gigante
      const result = await indicator.check("event_loop", 5000);

      expect(result.event_loop.status).toBe("up");
      expect(result.event_loop.lag).toBeDefined();
    });

    it("Debería retornar 'down' si forzamos un umbral imposible", async () => {
      // Le pasamos un retraso máximo negativo para forzar que siempre falle
      const result = await indicator.check("event_loop", -1);

      expect(result.event_loop.status).toBe("down");
      expect(result.event_loop.error).toContain(
        "Event loop lag exceeded threshold",
      );
    });
  });
});
