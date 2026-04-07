/**
 * @description Estado de salud de un indicador individual.
 */
export type HealthStatus = "up" | "down";

/**
 * @description El resultado de la evaluación de un indicador de salud específico.
 * La llave (key) será el nombre del servicio evaluado (ej: "database", "redis").
 */
export interface HealthIndicatorResult {
  [key: string]: {
    status: HealthStatus;
    [optionalKey: string]: any; // Permite agregar métricas extra como latencia, errores, etc.
  };
}

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
