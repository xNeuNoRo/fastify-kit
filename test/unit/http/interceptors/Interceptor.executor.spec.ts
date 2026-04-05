import { describe, it, expect, vi } from "vitest";

import { executeInterceptors } from "../../../../src/http/interceptors/interceptor.executor.js";
import type {
  Interceptor,
  ExecutionContext,
} from "../../../../src/http/interceptors/Interceptor.js";

describe("Motor de Ejecución de Interceptores (executeInterceptors)", () => {
  // Simulamos un contexto vacío ya que el motor solo lo pasa de largo
  const mockContext = {} as ExecutionContext;

  it("Debería ejecutar el controlador directamente si no hay interceptores", async () => {
    // Simulamos un controlador que devuelve un resultado simple
    const finalHandler = vi.fn().mockResolvedValue("resultado-controlador");

    // Ejecutamos el motor sin interceptores
    const result = await executeInterceptors(mockContext, [], finalHandler);

    // Validamos que el resultado es el esperado y que el controlador se ejecutó exactamente una vez
    expect(result).toBe("resultado-controlador");
    expect(finalHandler).toHaveBeenCalledOnce();
  });

  it("Debería ejecutar los interceptores en patrón onion (orden correcto de entrada y salida)", async () => {
    // Simulamos una traza para verificar el orden de ejecución de los interceptores y el controlador
    const traza: string[] = [];

    // Interceptores que registran su entrada y salida en la traza
    const interceptor1: Interceptor = {
      async intercept(_ctx, next) {
        traza.push("1-entrada");
        const res = await next.handle();
        traza.push("1-salida");
        return res;
      },
    };

    // Este interceptor se ejecutará entre el interceptor1 y el controlador
    const interceptor2: Interceptor = {
      async intercept(_ctx, next) {
        traza.push("2-entrada");
        const res = await next.handle();
        traza.push("2-salida");
        return res;
      },
    };

    // Simulamos un controlador que registra su ejecución en la traza
    const finalHandler = async () => {
      await Promise.resolve(); // Simulamos async
      traza.push("controlador");
      return "OK";
    };

    // Ejecutamos el motor con ambos interceptores y el controlador
    const result = await executeInterceptors(
      mockContext,
      [interceptor1, interceptor2],
      finalHandler,
    );

    // Validamos que el resultado es el esperado y que la traza refleja el orden correcto de ejecución
    expect(result).toBe("OK");
    expect(traza).toEqual([
      "1-entrada",
      "2-entrada",
      "controlador",
      "2-salida",
      "1-salida",
    ]);
  });

  it("Debería permitir que un interceptor mute el resultado final", async () => {
    // Este interceptor agrega una propiedad al resultado del controlador
    const interceptorMutador: Interceptor = {
      async intercept(_ctx, next) {
        const res = (await next.handle()) as Record<string, unknown>;
        return { ...res, interceptado: true };
      },
    };

    // Simulamos un controlador que devuelve un objeto simple
    const finalHandler = async () => {
      await Promise.resolve(); // Simulamos async
      return { original: true };
    };

    // Ejecutamos el motor con el interceptor mutador
    const result = await executeInterceptors(
      mockContext,
      [interceptorMutador],
      finalHandler,
    );

    // Validamos que el resultado contiene tanto la propiedad original del controlador como la nueva propiedad agregada por el interceptor
    expect(result).toHaveProperty("original", true);
    expect(result).toHaveProperty("interceptado", true);
    expect(result).toEqual({ original: true, interceptado: true });
  });

  it("Debería cortar el flujo (short-circuit) si un interceptor no llama a next.handle()", async () => {
    const interceptorCache: Interceptor = {
      async intercept() {
        await Promise.resolve(); // Simulamos async
        return "data-desde-cache"; // No llamamos a next.handle()
      },
    };

    // Simulamos un controlador que jamás debería ejecutarse
    const finalHandler = vi.fn().mockResolvedValue("data-desde-bd");

    // Ejecutamos el motor con el interceptor que corta el flujo
    const result = await executeInterceptors(
      mockContext,
      [interceptorCache],
      finalHandler,
    );

    // Validamos que el resultado proviene del interceptor y que el controlador no se ejecutó
    expect(result).toBe("data-desde-cache");
    expect(finalHandler).not.toHaveBeenCalled(); // El controlador jamás debe ejecutarse
  });

  it("Debería lanzar un error de seguridad si un interceptor llama a next.handle() múltiples veces", async () => {
    // Este interceptor malicioso intenta romper el patrón onion llamando a next.handle() más de una vez
    const interceptorMalicioso: Interceptor = {
      async intercept(_ctx, next) {
        await next.handle();
        return await next.handle();
      },
    };

    // Simulamos un controlador simple
    const finalHandler = async () => {
      await Promise.resolve(); // Simulamos async
      return "controlador";
    };

    // Esperamos que el motor detecte el abuso y lance un error para evitar comportamientos impredecibles
    await expect(
      executeInterceptors(mockContext, [interceptorMalicioso], finalHandler),
    ).rejects.toThrow();
  });
});
