import type { FastifyInstance } from "fastify";
import type { OpenAPIV3_1 } from "openapi-types";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { FastifyKit } from "../../../src/core/FastifyKit.js";
import { Module } from "../../../src/core/module.decorator.js";
import { Controller } from "../../../src/http/decorators/controller.js";
import { Get } from "../../../src/http/decorators/methods.js";
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiBearerAuth,
} from "../../../src/http/decorators/openapi/index.js";

// FASTIFY_KIT_METADATA_SYMBOL polyfill ya se ejecuta al importar los decoradores

describe("Integracion OpenAPI (E2E)", () => {
  let app: FastifyInstance;

  @ApiTags("Users")
  @Controller("/users")
  class UsersController {
    @Get("/:id")
    @ApiOperation({
      summary: "Obtener usuario por ID",
      description: "Devuelve el perfil publico del usuario",
    })
    @ApiParam({
      name: "id",
      description: "ID del usuario",
      example: "abc-123",
    })
    @ApiBearerAuth()
    getUser() {
      return { id: 1, username: "angel" };
    }
  }

  @Module({
    controllers: [UsersController],
  })
  class AppModule {}

  beforeAll(async () => {
    app = await FastifyKit.create({
      module: AppModule,
      swagger: {
        title: "Test API",
        description: "API de prueba",
        version: "1.0.0",
        servers: [{ url: "https://api.test.com", description: "Prod" }],
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
          apiKeyAuth: {
            type: "apiKey",
            in: "header",
            name: "X-API-Key",
          },
        },
        scalar: {
          theme: "deepSpace",
        },
      },
      jwt: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("Deberia generar spec OpenAPI 3.1 completa", () => {
    const spec = (
      app as unknown as { swagger: () => OpenAPIV3_1.Document }
    ).swagger();

    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("Test API");
    expect(spec.info.version).toBe("1.0.0");

    // Servers
    expect(spec.servers).toBeDefined();
    expect(spec.servers[0].url).toBe("https://api.test.com");

    // Paths
    expect(spec.paths).toBeDefined();
    const pathItem = spec.paths["/users/{id}"];
    expect(pathItem).toBeDefined();

    const getOp = pathItem.get;
    expect(getOp).toBeDefined();
    expect(getOp.summary).toBe("Obtener usuario por ID");
    expect(getOp.tags).toContain("Users");

    // Parameters
    expect(getOp.parameters).toBeDefined();
    const param = getOp.parameters.find(
      (p: OpenAPIV3_1.ParameterObject) => p.name === "id",
    );
    expect(param).toBeDefined();
    expect(param.in).toBe("path");

    // Security
    expect(getOp.security).toBeDefined();
    expect(getOp.security).toContainEqual({ bearerAuth: [] });

    // Security schemes
    expect(spec.components.securitySchemes.bearerAuth).toBeDefined();
    expect(spec.components.securitySchemes.bearerAuth.type).toBe("http");
    expect(spec.components.securitySchemes.apiKeyAuth.type).toBe("apiKey");
  });
});
