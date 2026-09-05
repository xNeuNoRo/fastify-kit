/**
 * @description Eventos de lectura de caché reportados a métricas.
 * Cardinalidad acotada (6 valores fijos): nunca se usan namespaces ni claves
 * como labels, para no inflar las series de Prometheus.
 */
export type CacheReadEvent =
  | "l1_hit"
  | "l1_stale"
  | "l2_hit"
  | "l2_stale"
  | "negative_hit"
  | "miss";

/** Estado de disponibilidad local observado para Redis L2. */
export type CacheRedisState = "healthy" | "degraded" | "half_open";

/**
 * @description Contrato mínimo de métricas de la caché.
 *
 * El CacheService lo reporta desde sus puntos internos (readThrough, carga,
 * locks, invalidación) SIN acoplar la lógica funcional a un proveedor de
 * métricas concreto: quien construye el adaptador (por defecto la capa de
 * observabilidad) mapea estos eventos a contadores/histogramas reales.
 *
 * Contratos del contrato:
 * - Los implementadores NO deben lanzar: un fallo de métricas nunca debe
 *   alterar el resultado funcional de la operación de caché.
 * - Solo eventos de cardinalidad fija; sin datos de usuario ni claves.
 *
 * @example
 * const metrics: CacheMetrics = {
 *   ...NOOP_CACHE_METRICS,
 *   onRead: (event) => console.log("cache read", event),
 * };
 */
export interface CacheMetrics {
  /**
   * Resultado de una lectura (por capa).
   * @param event Tipo de resultado con cardinalidad fija.
   */
  onRead(event: CacheReadEvent): void;
  /**
   * Duración de una ejecución del cargador (o refresco) en segundos.
   * @param seconds Duración observada en segundos.
   */
  onLoaderDuration(seconds: number): void;
  /** Una llamada no pudo adquirir el lock de carga (contienda). */
  onLockContention(): void;
  /** El cargador (o refresco) falló. */
  onLoaderError(): void;
  /** Se recibió un mensaje de invalidación distribuida. */
  onInvalidationReceived(): void;
  /**
   * Cambio de estado del circuito Redis (opcional para compatibilidad).
   * @param state Estado observado del circuito.
   */
  onRedisState?(state: CacheRedisState): void;
  /**
   * Se ejecutó una política de fallback por Redis degradado.
   * @param policy Política aplicada.
   */
  onFallback?(policy: "bypass-l1" | "stale-if-error" | "fail"): void;
  /** El bulkhead rechazó una carga por saturación. */
  onLoadShed?(): void;
  /**
   * Resultado de una operación Redis con operación de cardinalidad fija.
   * @param operation Nombre estable de la operación.
   * @param result Resultado de la operación.
   */
  onRedisOperation?(operation: string, result: "success" | "error"): void;
  /**
   * Duración de una operación Redis en segundos.
   * @param operation Nombre estable de la operación.
   * @param seconds Duración observada en segundos.
   */
  onRedisDuration?(operation: string, seconds: number): void;
}

/**
 * @description Implementación no-op por defecto.
 * Usada cuando la observabilidad no está activa: cero coste, cero acoplamiento.
 */
export const NOOP_CACHE_METRICS: CacheMetrics = {
  onRead: () => {},
  onLoaderDuration: () => {},
  onLockContention: () => {},
  onLoaderError: () => {},
  onInvalidationReceived: () => {},
  onRedisState: () => {},
  onFallback: () => {},
  onLoadShed: () => {},
  onRedisOperation: () => {},
  onRedisDuration: () => {},
};
