import type { HealthIndicatorResult } from "../interfaces.js";

/**
 * @description Clase abstracta base para todos los indicadores de salud en FastifyKit.
 * Proporciona el método 'getStatus' para formatear consistentemente el resultado de un chequeo.
 */
export abstract class HealthIndicator {
  /**
   * @description Genera el objeto de resultado estandarizado para un indicador.
   * @param key El nombre identificador de la dependencia (ej. 'database', 'redis', 'stripe')
   * @param isHealthy Booleano que indica si la dependencia está operando correctamente.
   * @param data (Opcional) Objeto con métricas extra para adjuntar (ej. { latency: "12ms", error: "Timeout" })
   */
  protected getStatus(
    key: string,
    isHealthy: boolean,
    data?: Record<string, unknown>,
  ): HealthIndicatorResult {
    return {
      [key]: {
        status: isHealthy ? "up" : "down",
        ...data,
      },
    };
  }
}
