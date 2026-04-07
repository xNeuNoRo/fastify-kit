/**
 * @description Estado de salud de un indicador individual.
 */
export type HealthStatus = "up" | "down";

/**
 * @description Detalle de la evaluación de un servicio.
 * Ej: { status: "up", latency: "12ms" }
 * { status: "down", latency: "200ms", error: "Database connection failed" }
 */
export interface HealthIndicatorDetails {
  status: HealthStatus;
  latency?: string;
  error?: string;
  // Firma de índice segura para cualquier otra métrica custom
  [optionalKey: string]: unknown;
}

/**
 * @description El resultado de la evaluación de un indicador de salud.
 * Ej: { "database": { status: "up", latency: "12ms" } }
 */
export type HealthIndicatorResult = Record<string, HealthIndicatorDetails>;

/**
 * @description El reporte global de salud que devolverá el endpoint /health.
 * Sigue el estándar del Patrón Terminus.
 */
export interface HealthCheckResult {
  /** Estado global del servidor. "error" si al menos un indicador falló. */
  status: "ok" | "error";
  /** Diccionario con los indicadores que pasaron exitosamente. */
  info: HealthIndicatorResult;
  /** Diccionario con los indicadores que fallaron. */
  error: HealthIndicatorResult;
  /** La combinación total de info y error para una vista rápida. */
  details: HealthIndicatorResult;
}
