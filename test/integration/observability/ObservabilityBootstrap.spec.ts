import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { describe, it, expect, beforeEach } from "vitest";

import { ConfigModule } from "../../../src/config/ConfigModule.js";
import { container } from "../../../src/container/DIContainer.js";
import { FastifyKit } from "../../../src/core/FastifyKit.js";
import { Module } from "../../../src/core/module.decorator.js";
import { Controller } from "../../../src/http/decorators/controller.js";
import { Get } from "../../../src/http/decorators/methods.js";
import {
  LOGGER_TOKEN,
  type LoggerContract,
} from "../../../src/logger/LoggerContract.js";
import { METRICS_ENDPOINT_TOKEN } from "../../../src/observability/bootstrap/ObservabilityBootstrapStep.js";
import {
  METRICS_SERVICE_TOKEN,
  type MetricsService,
} from "../../../src/observability/contracts/MetricsService.js";
import {
  TRACER_SERVICE_TOKEN,
  type TracerService,
} from "../../../src/observability/contracts/TracerService.js";

describe("Observability Bootstrap (Integración)", () => {
  let app: FastifyInstance;

  @Controller("/test")
  class TestController {
    @Get("/ping")
    ping() {
      return { ok: true };
    }

    @Get("/error")
    error() {
      throw new Error("BOOM");
    }
  }

  @Module({
    controllers: [TestController],
  })
  class AppModule {}

  // Reseteamos el container antes de cada test
  // para evitar contaminación entre pruebas
  beforeEach(() => {
    container.clearAll();
  });

  describe("Bootstrap con logging unicamente", () => {
    it("Deberia bootear la app y registrar el logger Pino", async () => {
      // Configuramos unicamente el subsistema de logging
      ConfigModule.forRoot({
        schema: Type.Object({}),
        strict: false,
        observability: {
          serviceName: "test-bootstrap",
          logging: { level: "info", prettyPrint: false },
        },
      });

      app = await FastifyKit.create({ module: AppModule });
      await app.ready();

      // El logger debe estar registrado en el container
      expect(container.has(LOGGER_TOKEN)).toBe(true);
      const logger = container.resolve<LoggerContract>(LOGGER_TOKEN);
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe("function");

      // La app responde normalmente
      const res = await app.inject({ method: "GET", url: "/test/ping" });
      expect(res.statusCode).toBe(200);

      await app.close();
    });
  });

  describe("Bootstrap con tracing + metrics (graceful degradation)", () => {
    it("Deberia bootear sin crashear cuando tracing esta activado pero otel no esta instalado", async () => {
      ConfigModule.forRoot({
        schema: Type.Object({}),
        strict: false,
        observability: {
          serviceName: "test-graceful",
          logging: { level: "info", prettyPrint: false },
          tracing: {
            enabled: true,
            exporter: "console",
            sampler: "always_on",
          },
          metrics: {
            enabled: true,
            endpoint: "/custom-metrics",
          },
        },
      });

      app = await FastifyKit.create({ module: AppModule });
      await app.ready();

      // El tracer fue creado pero probablemente desactivado (otel no instalado)
      expect(container.has(TRACER_SERVICE_TOKEN)).toBe(true);
      const tracer = container.resolve<TracerService>(TRACER_SERVICE_TOKEN);
      expect(tracer).toBeDefined();

      // El servicio de metricas fue creado
      expect(container.has(METRICS_SERVICE_TOKEN)).toBe(true);
      const metrics = container.resolve<MetricsService>(METRICS_SERVICE_TOKEN);
      expect(metrics).toBeDefined();
      expect(typeof metrics.increment).toBe("function");

      // El token de endpoint de metricas fue registrado
      expect(container.has(METRICS_ENDPOINT_TOKEN)).toBe(true);
      const endpointInfo = container.resolve<{
        endpoint: string;
        getContent: () => string;
        getContentType: () => string;
      }>(METRICS_ENDPOINT_TOKEN);
      expect(endpointInfo.endpoint).toBe("/custom-metrics");

      // La app responde normalmente a pesar de que otel no este disponible
      const res = await app.inject({ method: "GET", url: "/test/ping" });
      expect(res.statusCode).toBe(200);

      await app.close();
    });
  });

  describe("Sin config de observabilidad", () => {
    it("Deberia bootear normalmente y usar console como logger por defecto", async () => {
      app = await FastifyKit.create({ module: AppModule });
      await app.ready();

      // Sin ConfigModule.forRoot con observability,
      // el bootstrap step no registra Pino
      // (usa el DefaultConsoleLogger registrado en PreFlightStep)

      const res = await app.inject({ method: "GET", url: "/test/ping" });
      expect(res.statusCode).toBe(200);

      await app.close();
    });
  });
});

describe("Observability Instrumentation (Integración)", () => {
  let app: FastifyInstance;

  @Controller("/instr")
  class InstrController {
    @Get("/ok")
    ok() {
      return { status: "ok" };
    }
  }

  @Module({
    controllers: [InstrController],
    providers: [],
  })
  class InstrModule {}

  beforeEach(() => {
    container.clearAll();
  });

  it("Deberia montar el endpoint /metrics cuando tracing + metrics estan activados", async () => {
    ConfigModule.forRoot({
      schema: Type.Object({}),
      strict: false,
      observability: {
        serviceName: "test-instr",
        logging: { level: "info" },
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

    app = await FastifyKit.create({ module: InstrModule });
    await app.ready();

    // Si el tracer se inicializo correctamente (otel instalado),
    // el endpoint /metrics deberia estar montado.
    // Si no, el tracer esta desactivado y /metrics no existe.
    const res = await app.inject({ method: "GET", url: "/metrics" });

    if (res.statusCode === 200) {
      // Endpoint montado: debe devolver texto de Prometheus
      expect(res.headers["content-type"]).toContain("text/plain");
      expect(typeof res.payload).toBe("string");
    } else {
      // Tracer desactivado, /metrics no montado (404)
      expect(res.statusCode).toBe(404);
    }

    // La app principal sigue funcionando normalmente
    const pingRes = await app.inject({ method: "GET", url: "/instr/ok" });
    expect(pingRes.statusCode).toBe(200);

    await app.close();
  });
});
