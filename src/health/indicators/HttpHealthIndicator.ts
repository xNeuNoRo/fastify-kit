import { HealthIndicator } from "./HealthIndicator.js";
import type { HealthIndicatorResult } from "../interfaces.js";

export class HttpHealthIndicator extends HealthIndicator {
  /**
   * @param key Identificador (ej. "stripe_api")
   * @param url La URL a consultar.
   * @param options Configuración extra (timeout y código HTTP esperado).
   */
  async check(
    key: string,
    url: string,
    options: { timeoutMs?: number; expectedStatus?: number } = {},
  ): Promise<HealthIndicatorResult> {
    const timeout = options.timeoutMs || 5000;
    const expectedStatus = options.expectedStatus || 200;

    // Usamos AbortController para cancelar el fetch si excede el timeout
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    try {
      const startTime = Date.now();
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(id);

      const latency = Date.now() - startTime;
      const isHealthy = response.status === expectedStatus;

      return this.getStatus(key, isHealthy, {
        latency: `${latency}ms`,
        statusCode: response.status,
        ...(isHealthy
          ? {}
          : {
              error: `Expected status ${expectedStatus}, got ${response.status}`,
            }),
      });
    } catch (error) {
      clearTimeout(id);
      const message = error instanceof Error ? error.message : String(error);
      // Si el error es por el abort(), lo marcamos claramente como un timeout
      const errorMessage = message.includes("abort")
        ? `Timeout exceeded (${timeout}ms)`
        : message;

      return this.getStatus(key, false, { error: errorMessage });
    }
  }
}
