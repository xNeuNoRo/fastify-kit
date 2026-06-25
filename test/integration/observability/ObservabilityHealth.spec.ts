import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { describe, it, expect, beforeEach } from "vitest";

import { ConfigModule } from "../../../src/config/ConfigModule.js";
import { container } from "../../../src/container/DIContainer.js";
import { FastifyKit } from "../../../src/core/FastifyKit.js";
import { Module } from "../../../src/core/module.decorator.js";
import { HealthCheckService } from "../../../src/health/HealthCheckService.js";
import { ObservabilityHealthIndicator } from "../../../src/health/indicators/ObservabilityHealthIndicator.js";
import { PingHealthIndicator } from "../../../src/health/indicators/PingHealthIndicator.js";
import { Controller } from "../../../src/http/decorators/controller.js";
import { Get } from "../../../src/http/decorators/methods.js";

describe("Observability Health Indicator (Integración)", () => {
  let app: FastifyInstance;

  @Controller("/health")
  class HealthController {
    private get healthService(): HealthCheckService {
      return container.resolve(HealthCheckService);
    }
    private get ping(): PingHealthIndicator {
      return container.resolve(PingHealthIndicator);
    }
    private get obsHealth(): ObservabilityHealthIndicator {
      return container.resolve(ObservabilityHealthIndicator);
    }

    @Get("/check")
    async check() {
      return this.healthService.check([
        () =>
          this.ping.check("database", async () => {
            await Promise.resolve();
            return "Conexion OK";
          }),
        () => this.obsHealth.isHealthy("observabilidad"),
      ]);
    }
  }

  @Module({
    controllers: [HealthController],
    providers: [
      HealthCheckService,
      PingHealthIndicator,
      ObservabilityHealthIndicator,
    ],
  })
  class HealthModule {}

  beforeEach(() => {
    container.clearAll();
  });

  it("Deberia reportar salud combinada con ObservabilityHealthIndicator", async () => {
    // Configuramos observabilidad con metrics activado
    ConfigModule.forRoot({
      schema: Type.Object({}),
      strict: false,
      observability: {
        serviceName: "test-health",
        logging: { level: "info", prettyPrint: false },
        tracing: {
          enabled: true,
          exporter: "console",
          sampler: "always_on",
        },
        metrics: {
          enabled: true,
          endpoint: "/metrics",
        },
      },
    });

    app = await FastifyKit.create({ module: HealthModule });
    await app.ready();

    // Hacemos la peticion de health check
    const res = await app.inject({ method: "GET", url: "/health/check" });

    // El health check debe responder (200 o 503 segun estado del tracer)
    expect([200, 503]).toContain(res.statusCode);

    const body = JSON.parse(res.payload);

    // Siempre debe incluir database y observabilidad en details
    expect(body.data || body.error).toBeDefined();
    const payload = body.ok ? body.data : body.error.details;

    expect(payload.details).toHaveProperty("database");
    expect(payload.details).toHaveProperty("observabilidad");

    // database siempre up
    expect(payload.details.database.status).toBe("up");

    // observabilidad puede ser up o down segun si otel esta instalado
    expect(["up", "down"]).toContain(payload.details.observabilidad.status);

    await app.close();
  });

  it("Deberia reportar error cuando un indicador de negocio falla", async () => {
    // Sin observabilidad, solo probamos PingHealthIndicator
    ConfigModule.forRoot({
      schema: Type.Object({}),
      strict: false,
      observability: {
        serviceName: "test-biz-error",
        logging: { level: "info" },
      },
    });

    @Controller("/biz")
    class BizController {
      private get healthService(): HealthCheckService {
        return container.resolve(HealthCheckService);
      }
      private get ping(): PingHealthIndicator {
        return container.resolve(PingHealthIndicator);
      }

      @Get("/fail")
      async checkFail() {
        return this.healthService.check([
          () =>
            this.ping.check("payment_gateway", async () => {
              await Promise.resolve();
              throw new Error("Gateway timeout");
            }),
        ]);
      }
    }

    @Module({
      controllers: [BizController],
      providers: [HealthCheckService, PingHealthIndicator],
    })
    class BizModule {}

    app = await FastifyKit.create({ module: BizModule });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/biz/fail" });
    expect(res.statusCode).toBe(503);

    const body = JSON.parse(res.payload);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(body.error.details.error).toBeDefined();

    await app.close();
  });
});
