import type { Redis } from "ioredis";

import { container } from "../container/DIContainer.js";
import {
  INTERNAL_CONFIG_SERVICE_TOKEN,
  type InternalConfigService,
} from "../config/InternalConfigService.js";
import { REDIS_CONNECTION_TOKEN } from "../distributed/redis.token.js";
import { InMemoryCacheAdapter } from "./adapters/InMemoryCacheAdapter.js";
import { RedisCacheAdapter } from "./adapters/RedisCacheAdapter.js";
import { CacheService } from "./CacheService.js";
import {
  CACHE_ADAPTER_TOKEN,
  type CacheAdapter,
} from "./interfaces/CacheAdapter.js";
import {
  buildResolvedCacheConfig,
  getCacheLayerRequirements,
} from "./interfaces/CacheConfig.js";
import type { CacheMetrics } from "./interfaces/CacheMetrics.js";
import { claimApplicationResource } from "../core/application-context.js";

/**
 * @description Factory para obtener el adaptador de caché activo (CacheService).
 *
 * Resuelve el `CACHE_ADAPTER_TOKEN` del contenedor si existe (adaptador personalizado);
 * si no, construye el `CacheService` según el modo de configuración:
 *
 * - "l1-only": solo InMemoryCacheAdapter (sin Redis).
 * - "l2-only": solo RedisCacheAdapter (requiere `distributed.redis`).
 * - "multi": InMemoryCacheAdapter + RedisCacheAdapter con coherencia distribuida.
 *
 * El contenedor es el dueño del ciclo de vida: tras `container.clearAll()`
 * la próxima llamada reconstruye el servicio fresco (y su suscriptor).
 */
export async function getCacheAdapter(): Promise<CacheAdapter> {
  if (container.has(CACHE_ADAPTER_TOKEN)) {
    const adapter = container.resolve<CacheAdapter>(CACHE_ADAPTER_TOKEN);
    if (adapter instanceof CacheService) {
      claimApplicationResource(adapter, "cache adapter");
    }
    return adapter;
  }
  if (cacheInitialization) return cacheInitialization;

  const initialization = buildCacheAdapter();
  cacheInitialization = initialization;
  try {
    return await initialization;
  } finally {
    if (cacheInitialization === initialization) cacheInitialization = undefined;
  }
}

let cacheInitialization: Promise<CacheAdapter> | undefined;

async function buildCacheAdapter(): Promise<CacheAdapter> {
  const internalConfig = container.resolve<InternalConfigService>(
    INTERNAL_CONFIG_SERVICE_TOKEN,
  );
  const distributedConfig = internalConfig.get("distributed") || {};
  const cacheConfig = distributedConfig.features?.cache;
  const resolved = buildResolvedCacheConfig(cacheConfig);
  const requirements = getCacheLayerRequirements(resolved);

  let l1: InMemoryCacheAdapter | undefined;
  let l2: RedisCacheAdapter | undefined;

  if (requirements.needsL1) {
    l1 = new InMemoryCacheAdapter(resolved.l1);
  }

  if (requirements.needsL2) {
    if (!distributedConfig.redis) {
      throw new Error(
        "[FastifyKit Cache] La configuración efectiva requiere Redis para al menos un namespace. Añade 'distributed.redis' o cambia todos los modos efectivos a 'l1-only'.",
      );
    }
    const { registerRedisConnection } =
      await import("../distributed/redis.factory.js");
    await registerRedisConnection();

    l2 = new RedisCacheAdapter({
      redis: container.resolve<Redis>(REDIS_CONNECTION_TOKEN),
      keyPrefix: resolved.l2.keyPrefix,
      invalidationChannel: `${resolved.l2.keyPrefix}invalidate`,
      operationTimeoutMs: resolved.l2.operationTimeoutMs,
    });
  }

  // Observabilidad opcional: si el servicio de métricas está registrado, la caché
  // reporta lecturas/duraciones/bloqueos/errores. La carga del adaptador es dinámica
  // para no arrastrar la capa de observabilidad a la entrada del paquete.
  let metrics: CacheMetrics | undefined;
  const { METRICS_SERVICE_TOKEN } =
    await import("../observability/contracts/MetricsService.js");
  if (container.has(METRICS_SERVICE_TOKEN)) {
    const { buildCacheMetrics } =
      await import("../observability/instrumentations/cache.instrumentation.js");
    metrics = buildCacheMetrics(container.resolve(METRICS_SERVICE_TOKEN));
  }

  const service = new CacheService({ l1, l2, config: resolved, metrics });
  claimApplicationResource(service, "cache adapter");
  await service.start();
  container.registerInstance(CACHE_ADAPTER_TOKEN, service);
  return service;
}
