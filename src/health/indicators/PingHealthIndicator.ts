import { HealthIndicator } from "./HealthIndicator.js";
import type { HealthIndicatorResult } from "../interfaces.js";

/**
 * @description Indicador de salud genérico y agnóstico.
 * Sirve para bases de datos, Redis, Memcached o cualquier dependencia local.
 */
export class PingHealthIndicator extends HealthIndicator {
  /**
   * @param key Identificador (ej. "postgres", "redis")
   * @param pingCallback Función que ejecuta la prueba (ej. `() => prisma.$queryRaw('SELECT 1')`)
   */
  async check(
    key: string,
    pingCallback: () => Promise<unknown>,
  ): Promise<HealthIndicatorResult> {
    try {
      const startTime = Date.now();
      await pingCallback();
      const latency = Date.now() - startTime;

      return this.getStatus(key, true, { latency: `${latency}ms` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.getStatus(key, false, { error: message });
    }
  }
}