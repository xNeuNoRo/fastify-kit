import { ServiceUnavailableException } from "../http/exceptions/InfrastructureExceptions.js";
import type { HealthCheckResult } from "./interfaces.js";

/**
 * @description Excepción lanzada cuando uno o más indicadores de salud fallan.
 * Retorna automáticamente un HTTP 503 (Service Unavailable) y expone el reporte de fallos en la respuesta.
 */
export class HealthCheckError extends ServiceUnavailableException {
  constructor(
    message: string,
    public readonly causes: HealthCheckResult,
  ) {
    // Inyectamos el reporte 'causes' como el parámetro 'details' del ServiceUnavailableException
    super(message, causes);
  }
}
