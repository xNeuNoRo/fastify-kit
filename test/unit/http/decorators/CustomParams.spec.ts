import type { FastifyRequest, FastifyReply } from "fastify";
import { describe, it, expect } from "vitest";

import { createParamDecorator } from "../../../../src/http/decorators/parameters.js";
import type { PipeTransform } from "../../../../src/http/pipes/PipeTransform.js";
import { resolveParamValue } from "../../../../src/http/routing/scanner/parameter.resolver.js";

describe("Decoradores de Parámetros Personalizados (createParamDecorator)", () => {
  it("Debería crear correctamente la metadata del decorador", () => {
    // Creamos un decorador falso
    const CurrentUser = createParamDecorator((req) => req.headers["x-user"]);

    // Lo invocamos
    const result = CurrentUser();

    // Verificamos que construya el objeto plano esperado por @UseParams
    expect(result).toBeDefined();
    expect(result.type).toBe("custom");
    expect(typeof result.customFactory).toBe("function");
  });

  it("Debería ejecutar la fábrica personalizada y resolver su valor sincrónicamente", async () => {
    // Simulamos un request de Fastify
    const mockRequest = {
      headers: { "x-tenant-id": "empresa-123" },
    } as unknown as FastifyRequest;
    const mockReply = {} as FastifyReply;

    // Creamos la metadata como lo haría @UseParams
    const paramMeta = {
      index: 0,
      type: "custom",
      customFactory: (req: FastifyRequest) => req.headers["x-tenant-id"],
    };

    // Ejecutamos el resolver del Scanner
    const resolvedValue = await resolveParamValue(
      paramMeta,
      mockRequest,
      mockReply,
    );

    expect(resolvedValue).toBeDefined();
    expect(resolvedValue).toBe("empresa-123");
  });

  it("Debería soportar fábricas asíncronas (Promesas)", async () => {
    const mockRequest = {
      headers: { authorization: "Bearer token" },
    } as unknown as FastifyRequest;
    const mockReply = {} as FastifyReply;

    const paramMeta = {
      index: 0,
      type: "custom",
      customFactory: async (req: FastifyRequest) => {
        // Simulamos una consulta a BD o validación de token asíncrona
        await new Promise((resolve) => setTimeout(resolve, 10));
        return req.headers.authorization === "Bearer token"
          ? { id: 1, role: "admin" }
          : null;
      },
    };

    const resolvedValue = await resolveParamValue(
      paramMeta,
      mockRequest,
      mockReply,
    );

    expect(resolvedValue).toBeDefined();
    expect(resolvedValue).toEqual({ id: 1, role: "admin" });
  });

  it("Debería devolver undefined si el customFactory no está definido (graceful degradation)", async () => {
    const paramMeta = {
      index: 0,
      type: "custom",
      // Omitimos intencionalmente el customFactory
    };

    const resolvedValue = await resolveParamValue(
      paramMeta,
      {} as FastifyRequest,
      {} as FastifyReply,
    );

    expect(resolvedValue).toBeUndefined();
  });

  it("Debería guardar correctamente un Pipe si el usuario lo proporciona al invocar el decorador", () => {
    // Creamos un Pipe falso solo para el test
    class DummyPipe implements PipeTransform {
      transform(value: any) {
        return Number(value);
      }
    }

    const TenantId = createParamDecorator((req) => req.headers["x-tenant-id"]);

    // Invocamos el decorador pasándole nuestro DummyPipe como argumento, como lo haría el usuario al usarlo en un controlador
    const result = TenantId(DummyPipe);

    expect(result.type).toBe("custom");
    expect(typeof result.customFactory).toBe("function");
    // Verificamos la metadata
    expect(result.pipe).toBe(DummyPipe);
  });
});
