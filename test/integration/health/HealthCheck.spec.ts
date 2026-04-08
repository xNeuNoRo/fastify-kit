import { describe, it, expect, beforeEach } from "vitest";

import { container } from "../../../src/container/DIContainer.js";
import { FastifyKit } from "../../../src/core/FastifyKit.js";
import { Module } from "../../../src/core/module.decorator.js";
import { HealthCheckService } from "../../../src/health/HealthCheckService.js";
import { PingHealthIndicator } from "../../../src/health/indicators/PingHealthIndicator.js";
import { Controller } from "../../../src/http/decorators/controller.js";
import { Get } from "../../../src/http/decorators/methods.js";
import { LOGGER_TOKEN } from "../../../src/logger/LoggerContract.js";

// Aseguramos que el símbolo para metadata esté definido
if (!(Symbol as any).metadata) {
  (Symbol as any).metadata = Symbol.for("Symbol.metadata");
}

// Logger falso para inyectar en el módulo de prueba
class MockLogger {
  info() {
    /* dummy method */
  }
  warn() {
    /* dummy method */
  }
  error() {
    /* dummy method */
  }
  debug() {
    /* dummy method */
  }
}

describe("Health Checks (Integración)", () => {
  // Antes de cada test, limpiamos el contenedor para evitar contaminación entre pruebas
  beforeEach(() => {
    container.clearAll();
  });

  // Probamos el endpoint de health check con indicadores reales y verificamos el comportamiento completo del flujo
  it("Debería retornar HTTP 200 y el reporte completo si todo está sano", async () => {
    @Controller("/health")
    class HealthController {
      private get health(): HealthCheckService {
        return container.resolve(HealthCheckService);
      }
      private get ping(): PingHealthIndicator {
        return container.resolve(PingHealthIndicator);
      }

      @Get("/ok")
      async checkOk() {
        return await this.health.check([
          () =>
            // Simulamos un indicador exitoso usando el PingHealthIndicator real
            this.ping.check("database", async () => {
              await Promise.resolve(); // Simulamos async
              return "Conexión exitosa";
            }),
        ]);
      }
    }

    // Definimos un módulo de prueba que incluye el controlador y
    // los servicios necesarios, inyectando un logger falso para evitar ruido en los logs durante las pruebas
    @Module({
      controllers: [HealthController],
      providers: [
        HealthCheckService,
        PingHealthIndicator,
        { contract: LOGGER_TOKEN, implementation: MockLogger }, // Inyectamos el logger falso
      ],
    })
    class TestModule {}

    // Creamos la aplicación FastifyKit con el módulo de prueba y hacemos una solicitud al endpoint de health check
    const app = await FastifyKit.create({ module: TestModule });
    const response = await app.inject({ method: "GET", url: "/health/ok" });

    // Validamos que la respuesta es HTTP 200 OK y que el cuerpo tiene el formato esperado con el reporte de salud
    expect(response.statusCode).toBe(200);

    // Validamos el contrato del reporte
    const body = JSON.parse(response.payload);
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe("ok");
    expect(body.data.info.database.status).toBe("up");

    await app.close();
  });

  it("Debería retornar HTTP 503 (Service Unavailable) si un indicador falla", async () => {
    @Controller("/health")
    class HealthController {
      private get health(): HealthCheckService {
        return container.resolve(HealthCheckService);
      }
      private get ping(): PingHealthIndicator {
        return container.resolve(PingHealthIndicator);
      }

      // Simulamos un endpoint que tiene un indicador exitoso y otro que falla para probar el reporte de error completo
      @Get("/error")
      async checkError() {
        return await this.health.check([
          () =>
            this.ping.check("database", async () => {
              await Promise.resolve(); // Simulamos async
              return "Conexión exitosa";
            }),
          () =>
            this.ping.check("redis", async () => {
              await Promise.resolve(); // Simulamos async
              throw new Error("Conexión rechazada");
            }),
        ]);
      }
    }

    // Definimos un módulo de prueba que incluye el controlador
    // y los servicios necesarios, inyectando un logger falso para evitar ruido en los logs durante las pruebas
    @Module({
      controllers: [HealthController],
      providers: [
        HealthCheckService,
        PingHealthIndicator,
        { contract: LOGGER_TOKEN, implementation: MockLogger }, // Inyectamos el logger falso
      ],
    })
    class TestModule {}

    // Creamos la aplicación FastifyKit con el módulo de prueba
    // y hacemos una solicitud al endpoint de health check que simula un error
    const app = await FastifyKit.create({ module: TestModule });
    const response = await app.inject({ method: "GET", url: "/health/error" });

    // LA PRUEBA DE FUEGO FINAL
    expect(response.statusCode).toBe(503);

    const body = JSON.parse(response.payload);

    // Validamos el contrato del reporte de error
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(body.error.details.status).toBe("error");
    expect(body.error.details.info.database.status).toBe("up");
    expect(body.error.details.error.redis.status).toBe("down");
    expect(body.error.details.error.redis.error).toBe("Conexión rechazada");

    await app.close();
  });
});
