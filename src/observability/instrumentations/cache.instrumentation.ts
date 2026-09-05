import type {
  CacheMetrics,
  CacheReadEvent,
} from "../../cache/interfaces/CacheMetrics.js";
import { getLogger } from "../../logger/logger.factory.js";
import type { MetricsService } from "../contracts/MetricsService.js";

/**
 * @description Nombres de métricas de caché expuestas en /metrics.
 * Cardinalidad acotada: `cache_read_total` usa como label el evento fijo
 * (l1_hit/l1_stale/l2_hit/l2_stale/negative_hit/miss); nunca namespaces ni claves.
 */
export const CACHE_METRICS_NAMES = {
  reads: "cache_read_total",
  loaderDuration: "cache_loader_duration_seconds",
  lockContention: "cache_lock_contention_total",
  loaderError: "cache_loader_error_total",
  invalidationReceived: "cache_invalidation_received_total",
  redisOperations: "cache_redis_operations_total",
  redisDuration: "cache_redis_duration_seconds",
  fallback: "cache_fallback_total",
  loadShed: "cache_load_shed_total",
  redisState: "cache_redis_state",
} as const;

/**
 * @description Construye el adapter de métricas de caché sobre el
 * `MetricsService` del framework (Prometheus).
 *
 * Todas las llamadas se protegen con try/catch: un fallo de métricas (por
 * ejemplo, un provider de métricas mal configurado) se loguea y NUNCA altera
 * el resultado funcional de la operación de caché.
 */
export function buildCacheMetrics(metrics: MetricsService): CacheMetrics {
  const safe = <Args extends unknown[]>(
    operation: (...args: Args) => void,
  ): ((...args: Args) => void) => {
    return (...args: Args): void => {
      try {
        operation(...args);
      } catch (error) {
        getLogger().warn(
          `[FastifyKit Cache] Error reportando métricas: ${
            (error as Error).message
          }`,
        );
      }
    };
  };

  return {
    onRead: safe((event: CacheReadEvent) => {
      metrics.increment(CACHE_METRICS_NAMES.reads, { result: event });
    }),
    onLoaderDuration: safe((seconds: number) => {
      metrics.histogram(CACHE_METRICS_NAMES.loaderDuration, seconds);
    }),
    onLockContention: safe(() => {
      metrics.increment(CACHE_METRICS_NAMES.lockContention);
    }),
    onLoaderError: safe(() => {
      metrics.increment(CACHE_METRICS_NAMES.loaderError);
    }),
    onInvalidationReceived: safe(() => {
      metrics.increment(CACHE_METRICS_NAMES.invalidationReceived);
    }),
    onRedisState: safe((state: "healthy" | "degraded" | "half_open") => {
      for (const candidate of ["healthy", "degraded", "half_open"] as const) {
        metrics.gauge(
          CACHE_METRICS_NAMES.redisState,
          candidate === state ? 1 : 0,
          {
            state: candidate,
          },
        );
      }
    }),
    onFallback: safe((policy: "bypass-l1" | "stale-if-error" | "fail") => {
      metrics.increment(CACHE_METRICS_NAMES.fallback, { policy });
    }),
    onLoadShed: safe(() => {
      metrics.increment(CACHE_METRICS_NAMES.loadShed);
    }),
    onRedisOperation: safe((operation: string, result: "success" | "error") => {
      metrics.increment(CACHE_METRICS_NAMES.redisOperations, {
        operation,
        result,
      });
    }),
    onRedisDuration: safe((operation: string, seconds: number) => {
      metrics.histogram(CACHE_METRICS_NAMES.redisDuration, seconds, {
        operation,
      });
    }),
  };
}
