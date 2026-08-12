import { Injectable } from "../../container/injectable.decorator.js";
import { Inject } from "../../container/inject.decorator.js";
import { METRICS_SERVICE_TOKEN, type MetricsService } from "../../observability/contracts/MetricsService.js";
import { TRACER_SERVICE_TOKEN, type TracerService } from "../../observability/contracts/TracerService.js";
import { LOGGER_TOKEN, type LoggerContract } from "../../logger/LoggerContract.js";
import { HealthIndicator } from "./HealthIndicator.js";
import type { HealthIndicatorResult } from "../interfaces.js";

/**
 * @description Indicador de salud que verifica el estado del subsistema de observabilidad.
 * Comprueba que:
 * - El endpoint de métricas Prometheus esté funcionando y devolviendo datos
 * - El tracer de OpenTelemetry esté inicializado y operativo
 *
 * Se usa con HealthCheckService para health checks de Kubernetes (liveness/readiness).
 *
 * @example
 * const healthService = new HealthCheckService();
 * const result = await healthService.check([
 *   () => new ObservabilityHealthIndicator().isHealthy("observabilidad"),
 * ]);
 * // result = { status: "ok", info: { observabilidad: { status: "up" } } }
 */
@Injectable()
export class ObservabilityHealthIndicator extends HealthIndicator {
  @Inject(METRICS_SERVICE_TOKEN)
  private readonly metrics!: MetricsService;

  @Inject(TRACER_SERVICE_TOKEN)
  private readonly tracer!: TracerService;

  @Inject(LOGGER_TOKEN)
  private readonly logger!: LoggerContract;

  /**
   * @description Ejecuta las comprobaciones de salud del subsistema de observabilidad.
   * Verifica el endpoint de métricas y el estado del tracer.
   *
   * @param key Nombre identificador del indicador (ej: "observabilidad")
   * @returns Resultado del health check con estado up/down y detalles por componente
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    // Definimos las comprobaciones individuales
    const checks: Record<string, () => Promise<{ status: string; details?: any }>> = {
      /** Verifica que el endpoint /metrics devuelva datos */
      metrics: async () => {
        try {
          const endpoint = this.metrics.getMetricsEndpoint();
          return endpoint
            ? { status: "up", details: { available: true } }
            : { status: "down", details: { error: "sin datos de métricas" } };
        } catch (err) {
          return { status: "down", details: { error: (err as Error).message } };
        }
      },
      /** Verifica que el tracer de OpenTelemetry esté inicializado */
      tracer: async () => {
        try {
          return this.tracer.isEnabled()
            ? { status: "up", details: { initialized: true } }
            : { status: "down", details: { error: "tracer desactivado" } };
        } catch (err) {
          return { status: "down", details: { error: (err as Error).message } };
        }
      },
    };

    const details: Record<string, any> = {};
    let hasErrors = false;

    // Ejecutamos todas las comprobaciones y recolectamos resultados
    for (const [name, check] of Object.entries(checks)) {
      try {
        const result = await check();
        details[name] = result.details || {};
        if (result.status !== "up") {
          hasErrors = true;
        }
      } catch (err) {
        hasErrors = true;
        details[name] = { status: "error", error: (err as Error).message };
      }
    }

    // Devolvemos el resultado formateado con el helper de HealthIndicator
    return this.getStatus(key, !hasErrors, details);
  }
}
