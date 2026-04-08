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

describe("Ganchos de Ciclo de Vida (Lifecycle Hooks)", () => {
  // Arreglo para registrar cronológicamente en qué orden se ejecutan los métodos
  const executionOrder: string[] = [];

  // Diccionario para capturar los listeners que el framework registra en el SO
  const processHandlers: Record<string, (...args: unknown[]) => void> = {};
  let originalProcessOnce: typeof process.on;
  let processExitSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeEach(() => {
    executionOrder.length = 0;

    // Limpiamos el contenedor DI para que las pruebas no generen conflictos
    container.clearAll();

    // Mockeamos la consola para mantener limpia la salida de las pruebas
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Interceptamos process.exit y lanzamos un error en su lugar
    // para detener la ejecución sin matar el Test Runner de Vitest
    processExitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    // Interceptamos process.on para secuestrar los eventos SIGTERM/SIGINT
    originalProcessOnce = process.once.bind(process);
    vi.spyOn(process, "once").mockImplementation(((
      event: string,
      listener: (...args: unknown[]) => void,
    ) => {
      if (event === "SIGTERM" || event === "SIGINT") {
        processHandlers[event] = listener;
        return process; // Retornamos process para permitir encadenamiento
      }
      return originalProcessOnce(event, listener as (...args: any[]) => void);
    }) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Controlador de prueba que implementa el ciclo de vida completo
  @Controller("/lifecycle")
  class LifecycleController
    implements
      OnModuleInit,
      OnApplicationBootstrap,
      OnServerReady,
      BeforeApplicationShutdown,
      OnApplicationShutdown
  {
    onModuleInit() {
      executionOrder.push("onModuleInit");
    }
    onApplicationBootstrap() {
      executionOrder.push("onApplicationBootstrap");
    }
    onServerReady() {
      executionOrder.push("onServerReady");
    }
    beforeApplicationShutdown(signal?: string) {
      executionOrder.push(`beforeApplicationShutdown:${signal}`);
    }
    onApplicationShutdown() {
      executionOrder.push("onApplicationShutdown");
    }
  }

  // Módulo dummy para inicializar FastifyKit
  @Module({ controllers: [LifecycleController] })
  class LifecycleModule {}

  it("Debería ejecutar los hooks de arranque en el orden cronológico estricto", async () => {
    const app = await FastifyKit.create({
      module: LifecycleModule,
    });

    // Hasta este punto, la app fue creada pero NO está escuchando en el puerto.
    // Solo las fases 1 y 2 deben haberse ejecutado.
    expect(executionOrder).toEqual(["onModuleInit", "onApplicationBootstrap"]);

    // Simulamos que el servidor arranca y abre el puerto
    await app.listen({ port: 0 });

    // Ahora el puerto está abierto, Fastify dispara el hook nativo 'onListen' (Fase 3)
    expect(executionOrder).toEqual([
      "onModuleInit",
      "onApplicationBootstrap",
      "onServerReady",
    ]);

    // Cerramos el servidor manualmente (ej. durante un test)
    await app.close();

    // Al hacer app.close(), Fastify dispara su hook 'onClose' (Fase 5)
    expect(executionOrder).toEqual([
      "onModuleInit",
      "onApplicationBootstrap",
      "onServerReady",
      "onApplicationShutdown",
    ]);
  });

  it("Debería interceptar señales del SO (SIGTERM) y ejecutar los hooks de apagado en orden", async () => {
    const app = await FastifyKit.create({
      module: LifecycleModule,
    });
    await app.listen({ port: 0 });

    // Limpiamos el historial de ejecución para enfocarnos solo en la secuencia de apagado
    executionOrder.length = 0;

    // Obtenemos el handler de SIGTERM que FastifyKit secuestró y registró
    const sigtermHandler = processHandlers["SIGTERM"];
    expect(sigtermHandler).toBeDefined();

    // Ejecutamos manualmente el handler de SIGTERM para simular que el proceso recibió esa señal
    // Esto retorna void por lo tanto no es necesario validarlo como antes
    sigtermHandler();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Validamos el orden de la Fase 4 y Fase 5:
    // 1. Ejecutó beforeApplicationShutdown con la señal correcta
    // 2. Cerró Fastify, lo que disparó onApplicationShutdown
    expect(executionOrder).toEqual([
      "beforeApplicationShutdown:SIGTERM",
      "onApplicationShutdown",
    ]);

    // Verificamos que se intentó salir con código exitoso
    expect(processExitSpy).toHaveBeenCalledWith(0);
  });

  it("Debería propagar el error y fallar ruidosamente (Fail-Fast) si un hook de arranque falla", async () => {
    @Controller("/error")
    class ErrorController implements OnModuleInit {
      onModuleInit() {
        throw new Error("Base de datos inalcanzable");
      }
    }

    @Module({ controllers: [ErrorController] })
    class ErrorModule {}

    // El servidor ni siquiera debe terminar de crearse
    await expect(
      FastifyKit.create({
        module: ErrorModule,
      }),
    ).rejects.toThrow("Base de datos inalcanzable");

    // Verificamos que FastifyKit registró el log de la falla
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
