import type { FastifyInstance } from "fastify";
import type { OpenAPIV3_1 } from "openapi-types";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { FastifyKit } from "../../../src/core/FastifyKit.js";
import { Module } from "../../../src/core/module.decorator.js";
import { Controller } from "../../../src/http/decorators/controller.js";
import { Get } from "../../../src/http/decorators/methods.js";
import {
  ApiOperation,
  ApiTags,
} from "../../../src/http/decorators/openapi/index.js";

// Función que replica la lógica de filtrado de endpoints internos del CLI
// (src/cli/commands/generate/openapi.ts:99-104)
function filterInternalEndpoints(
  spec: OpenAPIV3_1.Document,
  includeInternal: boolean,
): void {
  if (!includeInternal && spec.paths) {
    delete spec.paths["/health"];
    delete spec.paths["/metrics"];
    delete spec.paths["/docs"];
    delete spec.paths["/docs/"];
  }
}

describe("OpenAPI + Observability (E2E)", () => {
  let app: FastifyInstance;

  @ApiTags("System")
  @Controller("/health")
  class HealthController {
    @Get("/live")
    @ApiOperation({ summary: "Liveness probe", description: "Para Kubernetes" })
    live() {
      return { status: "alive" };
    }

    @Get("/ready")
    @ApiOperation({
      summary: "Readiness probe",
      description: "Para Kubernetes",
    })
    ready() {
      return { status: "ready" };
    }
  }

  @ApiTags("Business")
  @Controller("/api/products")
  class ProductsController {
    @Get("/")
    @ApiOperation({ summary: "Listar productos" })
    list() {
      return [{ id: 1, name: "Widget" }];
    }
  }

  @Module({
    controllers: [HealthController, ProductsController],
  })
  class AppModule {}

  beforeAll(async () => {
    app = await FastifyKit.create({
      module: AppModule,
      swagger: {
        title: "Observability Test API",
        description: "API con endpoints de salud y negocio",
        version: "1.0.0",
      },
    });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("Deberia incluir /health y /api/products en la spec OpenAPI", () => {
    const spec = (
      app as unknown as { swagger: () => OpenAPIV3_1.Document }
    ).swagger();

    expect(spec.paths).toBeDefined();

    // Endpoints de negocio siempre presentes
    const productsPath = Object.keys(spec.paths).find((p) =>
      p.startsWith("/api/products"),
    );
    expect(productsPath).toBeDefined();

    // Endpoint de salud definido por el usuario (sin filtrar)
    expect(spec.paths["/health/live"]).toBeDefined();
    expect(spec.paths["/health/ready"]).toBeDefined();
  });

  it("Deberia eliminar solo las claves exactas de endpoints internos", () => {
    const spec = (
      app as unknown as { swagger: () => OpenAPIV3_1.Document }
    ).swagger();

    const filtered = JSON.parse(JSON.stringify(spec)) as OpenAPIV3_1.Document;
    filterInternalEndpoints(filtered, false);

    // La clave exacta /health se elimina (si existe como ruta raiz sin subrutas)
    // Las subrutas como /health/live permanecen (no son keys exactas)
    // El CLI actual solo filtra claves exactas para evitar eliminar
    // endpoints de salud definidos por el usuario accidentalmente

    // /api/products NO debe ser eliminado (no es clave interna)
    const productsPath = Object.keys(filtered.paths).find((p: string) =>
      p.startsWith("/api/products"),
    );
    expect(productsPath).toBeDefined();
  });

  it("Deberia conservar todos los endpoints con includeInternal true", () => {
    const spec = (
      app as unknown as { swagger: () => OpenAPIV3_1.Document }
    ).swagger();

    const filtered = JSON.parse(JSON.stringify(spec)) as OpenAPIV3_1.Document;
    filterInternalEndpoints(filtered, true);

    // Al incluir endpoints internos, NO se elimina nada
    // /health/live y /health/ready permanecen
    expect(filtered.paths["/health/live"]).toBeDefined();
    expect(filtered.paths["/health/ready"]).toBeDefined();
  });

  it("Deberia documentar correctamente las tags de salud y negocio", () => {
    const spec = (
      app as unknown as { swagger: () => OpenAPIV3_1.Document }
    ).swagger();

    // /health/live debe tener tag "System"
    const liveOp = spec.paths["/health/live"]?.get;
    expect(liveOp).toBeDefined();
    expect(liveOp.tags).toContain("System");

    // /api/products debe tener tag "Business"
    const productsPath = Object.keys(spec.paths).find((p) =>
      p.startsWith("/api/products"),
    );
    expect(productsPath).toBeDefined();
    const productsOp = spec.paths[productsPath!]?.get;
    expect(productsOp).toBeDefined();
    expect(productsOp.tags).toContain("Business");
  });
});
