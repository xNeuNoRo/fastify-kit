import { describe, it, expect, beforeEach } from "vitest";

import { HealthCheckError } from "../../../src/health/HealthCheckError.js";
import { HealthCheckService } from "../../../src/health/HealthCheckService.js";
import type { HealthIndicatorResult } from "../../../src/health/interfaces.js";

describe("HealthCheckService (Unitario)", () => {
  let service: HealthCheckService;

  beforeEach(() => {
    // Instanciamos el servicio fresco para cada test
    service = new HealthCheckService();
  });

  it("Debería retornar status 'ok' y poblar 'info' cuando todos los indicadores pasan", async () => {
    // Simulamos dos indicadores exitosos
    const checkDb = async (): Promise<HealthIndicatorResult> => {
      await Promise.resolve(); // Simulamos async
      return {
        database: { status: "up", latency: "10ms" },
      };
    };
    const checkRedis = async (): Promise<HealthIndicatorResult> => {
      await Promise.resolve(); // Simulamos async
      return {
        redis: { status: "up", memory: "12MB" },
      };
    };

    const result = await service.check([checkDb, checkRedis]);

    // Validamos el contrato del reporte feliz
    expect(result.status).toBe("ok");

    // Verificamos que 'info' tiene ambos servicios
    expect(result.info).toHaveProperty("database");
    expect(result.info.database.status).toBe("up");
    expect(result.info).toHaveProperty("redis");

    // Verificamos que 'error' está vacío
    expect(result.error).toEqual({});

    // Verificamos que 'details' tiene ambos servicios con sus métricas
    expect(result.details).toHaveProperty("database");
    expect(result.details).toHaveProperty("redis");
  });

  it("Debería lanzar HealthCheckError y poblar 'error' cuando un indicador reporta 'down'", async () => {
    // Simulamos un indicador exitoso y uno fallido
    const checkDb = async (): Promise<HealthIndicatorResult> => {
      await Promise.resolve().then(() => undefined); // Simulamos async
      return {
        database: { status: "up" },
      };
    };
    const checkApi = async (): Promise<HealthIndicatorResult> => {
      await Promise.resolve(); // Simulamos async
      return {
        stripe_api: { status: "down", error: "Timeout excedido" },
      };
    };

    // Verificamos que lanza la excepción
    await expect(service.check([checkDb, checkApi])).rejects.toThrow(
      HealthCheckError,
    );

    // Capturamos la excepción para analizar profundamente el payload 'causes'
    try {
      await service.check([checkDb, checkApi]);
    } catch (err) {
      expect(err).toBeInstanceOf(HealthCheckError);
      const healthError = err as HealthCheckError;

      // Validamos el contrato del reporte de error
      expect(healthError.causes.status).toBe("error");

      // El exitoso debe estar en 'info'
      expect(healthError.causes.info).toHaveProperty("database");

      // El fallido debe estar en 'error'
      expect(healthError.causes.error).toHaveProperty("stripe_api");
      expect(healthError.causes.error.stripe_api.status).toBe("down");
      expect(healthError.causes.error.stripe_api.error).toBe(
        "Timeout excedido",
      );
    }
  });

  it("Debería manejar promesas rechazadas (excepciones no capturadas) y usar el fallbackKey", async () => {
    const checkDb = async (): Promise<HealthIndicatorResult> => {
      await Promise.resolve(); // Simulamos async
      return {
        database: { status: "up" },
      };
    };

    // Simulamos una función que explota estrepitosamente sin retornar el objeto esperado
    const checkExplosive = async (): Promise<HealthIndicatorResult> => {
      await Promise.resolve(); // Simulamos async
      throw new Error("Conexión rechazada TCP");
    };

    try {
      // El orden importa para saber el índice del fallback (0 = checkDb, 1 = checkExplosive)
      await service.check([checkDb, checkExplosive]);
    } catch (err) {
      expect(err).toBeInstanceOf(HealthCheckError);
      const healthError = err as HealthCheckError;

      expect(healthError.causes.status).toBe("error");
      expect(healthError.causes.info).toHaveProperty("database");

      // Como la promesa explotó, el orquestador no sabe el nombre de la llave.
      // Debe usar el fallback "unknown_indicator_1" (porque estaba en el índice 1 del array)
      expect(healthError.causes.error).toHaveProperty("unknown_indicator_1");
      expect(healthError.causes.error.unknown_indicator_1.status).toBe("down");
      expect(healthError.causes.error.unknown_indicator_1.error).toBe(
        "Conexión rechazada TCP",
      );
    }
  });
});
