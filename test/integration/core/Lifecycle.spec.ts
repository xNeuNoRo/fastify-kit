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
import { Injectable } from "../../../src/container/injectable.decorator.js";
import { FastifyKit } from "../../../src/core/FastifyKit.js";
import type {
  OnModuleInit,
  OnApplicationBootstrap,
  OnServerReady,
  BeforeApplicationShutdown,
  OnApplicationShutdown,
} from "../../../src/core/interfaces/lifecycle.interface.js";
import { Module } from "../../../src/core/module.decorator.js";
import { Controller } from "../../../src/http/decorators/controller.js";
import { Get } from "../../../src/http/decorators/methods.js";
import { LOGGER_TOKEN } from "../../../src/logger/LoggerContract.js";

describe("Hooks de Ciclo de Vida de FastifyKit (Lifecycle Hooks)", () => {
  // Mockeamos el procces.exit para evitar que el test se cierre realmente
  let processExitSpy: MockInstance;
  // Creamos un array que nos ayudara a validar el orden de ejecución de los hooks y la persistencia del estado entre ellos
  const executionLog: string[] = [];

  // Clase dummy para simular un servicio con hooks de ciclo de vida
  @Injectable()
  class DatabaseService implements OnModuleInit, OnApplicationShutdown {
    public isConnected = false;

    async onModuleInit() {
      await new Promise((resolve) => setTimeout(resolve, 10));
      this.isConnected = true;
      executionLog.push("DatabaseService:Conectado");
    }

    async onApplicationShutdown() {
      await new Promise((resolve) => setTimeout(resolve, 10));
      this.isConnected = false;
      executionLog.push("DatabaseService:Desconectado");
    }
  }

  // Clase dummy para simular un servicio con hooks de ciclo de vida y paso de argumentos en el shutdown
  @Injectable()
  class CacheService
    implements OnApplicationBootstrap, BeforeApplicationShutdown
  {
    public isWarmedUp = false;

    onApplicationBootstrap() {
      this.isWarmedUp = true;
      executionLog.push("CacheService:Calentado");
    }

    beforeApplicationShutdown(signal?: string) {
      executionLog.push(`CacheService:Drenando por señal ${signal}`);
    }
  }

  // Controlador dummy para validar que los hooks de ciclo de vida se ejecutan
  // en el orden correcto y que el estado mutado en el arranque persiste en la petición
  @Controller("/status")
  class StatusController implements OnServerReady {
    onServerReady() {
      executionLog.push("StatusController:ServidorListo");
    }

    @Get("/")
    async getStatus() {
      await Promise.resolve(); // Simulamos async
      executionLog.push("StatusController:PeticionRecibida");

      const db = container.resolve(DatabaseService);
      const cache = container.resolve(CacheService);

      return {
        db: db.isConnected,
        cache: cache.isWarmedUp,
      };
    }
  }

  // Módulo dummy para registrar los servicios y el controlador
  @Module({
    controllers: [StatusController],
    providers: [DatabaseService, CacheService],
  })
  class AppModule {}

  // Antes de cada test limpiamos el contenedor, reseteamos el log de ejecución y mockeamos el logger y process.exit
  beforeEach(() => {
    executionLog.length = 0;
    container.clearAll();

    container.registerInstance(LOGGER_TOKEN, {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
    });

    // Mock silencioso de console para evitar ruido en la consola durante las pruebas
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Mock silencioso de process.exit
    processExitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);
  });

  // Después de cada test restauramos los mocks y eliminamos los listeners de señales para evitar interferencias entre tests
  afterEach(() => {
    vi.restoreAllMocks();
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
  });

  it("Debería ejecutar un flujo de vida real (Arranque -> Petición -> Apagado) con validación de estado y señales", async () => {
    const app = await FastifyKit.create({ module: AppModule });

    // Validamos que los hooks de arranque se ejecutaron en el orden correcto
    expect(executionLog).toEqual([
      "DatabaseService:Conectado",
      "CacheService:Calentado",
    ]);

    // Validamos que el hook de servidor listo se ejecutó
    await app.listen({ port: 0 });
    expect(executionLog).toContain("StatusController:ServidorListo");

    // Validamos que el hook de petición se ejecutó y que el estado mutado en el arranque persiste en la petición
    const res = await app.inject({ method: "GET", url: "/status" });
    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.payload);
    expect(payload.data).toEqual({
      db: true,
      cache: true,
    });
    /// Validamos que el log de ejecución contiene la marca de la petición,
    // lo que confirma que el hook de petición se ejecutó después del arranque
    // y que el estado mutado en el arranque está disponible en la petición
    expect(executionLog).toContain("StatusController:PeticionRecibida");

    // Simulamos una señal de apagado y validamos que los hooks de apagado se ejecutan en el orden correcto
    executionLog.length = 0;

    const listeners = process.listeners("SIGTERM");
    expect(listeners.length).toBeGreaterThan(0); // Aseguramos que registró el listener

    // Simulamos la recepción de la señal de apagado
    for (const listener of listeners) {
      await (listener as () => Promise<void>)();
    }

    /// Simular un pequeño delay para asegurar que los hooks de apagado
    // asíncronos terminen de ejecutarse antes de validar el log de ejecución
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Validamos que la señal llegó correctamente al hook de BeforeApplicationShutdown
    // y que los hooks de apagado se ejecutaron en el orden correcto
    expect(executionLog).toEqual([
      "CacheService:Drenando por señal SIGTERM",
      "DatabaseService:Desconectado",
    ]);

    // Validamos que process.exit se llamó con el código correcto después de ejecutar los hooks de apagado
    expect(processExitSpy).toHaveBeenCalledWith(0);

    // Validar que después del shutdown el estado de los servicios cambió
    const db = container.resolve(DatabaseService);
    expect(db.isConnected).toBe(false);
  });
});
