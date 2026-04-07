import { HealthIndicator } from "./HealthIndicator.js";
import type { HealthIndicatorResult } from "../interfaces.js";

export class EventLoopHealthIndicator extends HealthIndicator {
  /**
   * @param key Identificador (defecto: "event_loop")
   * @param maxLagMs El retraso máximo permitido en milisegundos (defecto: 150ms)
   */
  async check(
    key: string = "event_loop",
    maxLagMs: number = 150,
  ): Promise<HealthIndicatorResult> {
    return new Promise((resolve) => {
      const start = Date.now();

      // Truco en NODEJS, para medir el Event Loop aprovechamos,
      // el hecho de que el setTimout es una microtarea que se ejecuta inmediatamente después de que el Event Loop esté libre.
      // Si el Event Loop está bloqueado, el setTimeout se retrasará, y podemos medir ese retraso
      // para determinar la salud del Event Loop.
      setTimeout(() => {
        // Calculamos cuánto tiempo pasó realmente vs 1ms que pedimos
        const lag = Math.max(0, Date.now() - start - 1);
        const isHealthy = lag <= maxLagMs;

        resolve(
          this.getStatus(key, isHealthy, {
            lag: `${lag}ms`,
            maxLag: `${maxLagMs}ms`,
            ...(isHealthy
              ? {}
              : {
                  error: `Event loop lag exceeded threshold (${lag}ms > ${maxLagMs}ms)`,
                }),
          }),
        );
      }, 1);
    });
  }
}
