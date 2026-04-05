import { describe, it, expect, vi } from "vitest";

import { FastifyKit } from "../../../src/core/FastifyKit.js";
import { Module } from "../../../src/core/module.decorator.js";
import { Controller } from "../../../src/http/decorators/controller.js";
import { UseInterceptors } from "../../../src/http/decorators/interceptors.js";
import { Get } from "../../../src/http/decorators/methods.js";
import type {
  Interceptor,
  ExecutionContext,
  CallHandler,
} from "../../../src/http/interceptors/Interceptor.js";

describe("Interceptors (Onion Model)", () => {
  it("Debería ejecutar los interceptores en orden onion y permitir mutar la respuesta", async () => {
    const executionFlow: string[] = [];

    // Simulamos un escenario real con 2 interceptores y un controlador:

    // 1. Logger Interceptor
    class LoggerInterceptor implements Interceptor {
      async intercept(
        _context: ExecutionContext,
        next: CallHandler,
      ): Promise<unknown> {
        executionFlow.push("Logger: Enter");
        const result = await next.handle();
        executionFlow.push("Logger: Exit");
        return result;
      }
    }

    // 2. Mutation Interceptor
    class MutationInterceptor implements Interceptor {
      async intercept(
        context: ExecutionContext,
        next: CallHandler,
      ): Promise<unknown> {
        executionFlow.push("Mutation: Enter");
        const result = (await next.handle()) as Record<string, unknown>;
        executionFlow.push("Mutation: Exit");

        // Mutamos la respuesta agregando una nueva propiedad antes de que llegue a Fastify
        return { ...result, mutatedByInterceptor: true };
      }
    }

    // Simulamos un controlador real que devuelve datos puros sin preocuparse por la mutación o el logging
    @Controller("/test")
    class TestController {
      @Get("/data")
      @UseInterceptors(LoggerInterceptor, MutationInterceptor)
      getData() {
        executionFlow.push("Controller: Execution");
        return { original: "pure-data" };
      }
    }

    // Simulamos un modulo real que implemente dicho controlador
    @Module({ controllers: [TestController] })
    class TestModule {}

    // Inicializamos una app con dicho modulo para hacer una petición real y validar el flujo
    const app = await FastifyKit.create({ module: TestModule });

    // Inyectamos una petición real a nuestro endpoint para validar el flujo completo con los interceptores
    const res = await app.inject({
      method: "GET",
      url: "/test/data",
    });

    // Validamos que la respuesta final tenga tanto los datos originales del controlador como la mutación del interceptor
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);

    expect(json.data.original).toBe("pure-data");
    expect(json.data.mutatedByInterceptor).toBe(true);

    // Validamos que el orden de ejecución fue el correcto según el modelo onion:
    expect(executionFlow).toEqual([
      "Logger: Enter",
      "Mutation: Enter",
      "Controller: Execution",
      "Mutation: Exit",
      "Logger: Exit",
    ]);

    // Finalmente cerramos la app
    await app.close();
  });

  it("Debería permitir hacer short-circuit (cortar ejecución) sin llamar al controlador", async () => {
    const controllerSpy = vi.fn();

    // Simulamos un escenario real con un interceptor que hace short-circuit:

    // Cache Interceptor que corta la ejecución y devuelve datos cacheados sin llamar al controlador
    class CacheInterceptor implements Interceptor {
      async intercept(
        _context: ExecutionContext,
        _next: CallHandler,
      ): Promise<unknown> {
        await Promise.resolve(); // Simulamos async
        return { message: "data-from-cache-interceptor" };
      }
    }

    // Simulamos un controlador real que NUNCA debería ser llamado debido al short-circuit del interceptor
    @Controller("/test2")
    class ShortCircuitController {
      @Get("/cache")
      @UseInterceptors(CacheInterceptor)
      getBlockedRoute() {
        controllerSpy();
        return { message: "real-db-data" };
      }
    }

    // Simulamos un modulo real que implemente dicho controlador
    @Module({ controllers: [ShortCircuitController] })
    class TestModule2 {}

    // Creamos la app
    const app = await FastifyKit.create({ module: TestModule2 });

    // Inyectamos una petición real a nuestro endpoint
    const res = await app.inject({
      method: "GET",
      url: "/test2/cache",
    });

    // Validamos que la respuesta tenga los datos del interceptor y no del controlador
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.payload);
    expect(json.data.message).toBe("data-from-cache-interceptor");

    // Validamos que el controlador NUNCA fue llamado debido al short-circuit del interceptor
    expect(controllerSpy).not.toHaveBeenCalled();

    await app.close();
  });
});
