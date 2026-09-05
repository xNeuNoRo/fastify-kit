import type {
  CacheMode,
  CacheRedisFailurePolicy,
  DistributedCacheOptions,
} from "../../core/interfaces/cache.interface.js";
import { validateCacheNamespace } from "../namespace.js";

/**
 * @description Configuración L1 resuelta (valores concretos, sin opcionales).
 */
export interface ResolvedCacheL1Options {
  /** Número máximo de entradas L1 (LRU). */
  maxSize: number;
  /** TTL por defecto de L1 en milisegundos. */
  defaultTtlMs: number;
}

/**
 * @description Configuración L2 resuelta (valores concretos, sin opcionales).
 */
export interface ResolvedCacheL2Options {
  /** Prefijo de claves L2 en Redis. */
  keyPrefix: string;
  /** TTL fresco por defecto de L2 en milisegundos. */
  defaultTtlMs: number;
  /** Ventana stale de L2 en milisegundos.
   * Esto permite servir entradas stale mientras se refrescan, y es mayor o igual que `defaultTtlMs`.
   * Ej: si `defaultTtlMs` es 5 minutos y `staleTtlMs` es 1 hora, una entrada puede ser servida hasta 1 hora después de su expiración, mientras se intenta refrescarla en segundo plano.
   */
  staleTtlMs: number;
  /** TTL de caché negativa en milisegundos.
   * Esto implica que si un loader devuelve un resultado vacío o 404, se cachea como negativo por este tiempo.
   * Ej: si `negativeTtlMs` es 30 segundos, un resultado negativo se cachea por 30 segundos antes de permitir un nuevo intento de carga.
   */
  negativeTtlMs: number;
  /** TTL de locks distribuidos en milisegundos.
   * Esto es el tiempo máximo que un lock de carga puede estar activo antes de considerarse expirado.
   * Ej: si `lockTtlMs` es 5 segundos, un lock de carga se libera automáticamente después de 5 segundos si no se libera explícitamente.
   */
  lockTtlMs: number;
  /** Timeout de comandos Redis en milisegundos.
   * Esto es el tiempo máximo que se espera por una respuesta de Redis antes de considerar la operación fallida.
   * Ej: si `operationTimeoutMs` es 500 ms, cualquier comando Redis que tarde más de 500 ms se considera fallido y se aplica la política de error configurada.
   */
  operationTimeoutMs: number;
  /** Fallos consecutivos antes de abrir el circuito Redis.
   * Esto es el número de fallos consecutivos de Redis que se toleran antes de abrir el circuito y aplicar la política de error.
   * Ej: si `failureThreshold` es 3, después de 3 fallos consecutivos de Redis, el circuito se abre y se aplica la política de error configurada.
   */
  failureThreshold: number;
  /** Tiempo de recuperación del circuito en milisegundos. */
  recoveryTimeoutMs: number;
  /** Tiempo máximo esperando locks de mutación. */
  mutationWaitMs: number;
}

/**
 * @description Configuración del proceso de carga resuelta.
 */
export interface ResolvedCacheLoadOptions {
  /** Límite de cargas simultáneas hacia la fuente. */
  maxConcurrent: number;
  /** Límite de esperas antes de fallback controlado. */
  maxWaiters: number;
  /** Reintentos al no poder adquirir el lock de carga. */
  retryAttempts: number;
  /** Retardo base entre reintentos en milisegundos. */
  retryDelayMs: number;
  /** Límite global de tareas esperando un slot de loader. */
  maxQueuedLoads: number;
}

/**
 * @description Configuración resuelta de un namespace.
 * `l1TtlMs`/`l2TtlMs` son `null` cuando el namespace no los define (usa el default de la capa).
 */
export interface ResolvedCacheNamespaceOptions {
  /** Modo efectivo del namespace (hereda el modo global si no lo define). */
  mode: CacheMode;
  /** Permite servir entradas stale mientras se refrescan. */
  allowStale: boolean;
  /** TTL L1 específico del namespace en ms, o `null` para usar el default. */
  l1TtlMs: number | null;
  /** TTL fresco L2 específico del namespace en ms, o `null` para usar el default. */
  l2TtlMs: number | null;
  /** TTL total L2 específico del namespace en ms, o `null` para usar el default. */
  staleTtlMs: number | null;
  /** Política Redis específica del namespace. */
  onRedisError: CacheRedisFailurePolicy;
}

/**
 * @description Configuración interna de la caché completamente resuelta,
 * lista para consumir por adapters y el servicio de caché.
 * Se construye con `buildResolvedCacheConfig` a partir de la configuración pública.
 */
export interface ResolvedCacheAdapterConfig {
  /** Modo global efectivo de la caché. */
  mode: CacheMode;
  /** Política Redis global efectiva. */
  onRedisError: CacheRedisFailurePolicy;
  /** Configuración L1 resuelta. */
  l1: ResolvedCacheL1Options;
  /** Configuración L2 resuelta. */
  l2: ResolvedCacheL2Options;
  /** Configuración del proceso de carga resuelta. */
  load: ResolvedCacheLoadOptions;
  /** Configuración por namespace resuelta. */
  namespaces: Record<string, ResolvedCacheNamespaceOptions>;
}

/** Capas físicas necesarias para materializar todas las políticas efectivas. */
export interface CacheLayerRequirements {
  needsL1: boolean;
  needsL2: boolean;
}

/**
 * @description Defaults de la configuración interna de la caché.
 * La caché sin configuración de usuario equivale a "l1-only" con estos valores.
 */
export const DEFAULT_RESOLVED_CACHE_CONFIG: ResolvedCacheAdapterConfig = {
  mode: "l1-only",
  l1: {
    maxSize: 10_000,
    defaultTtlMs: 60_000,
  },
  l2: {
    keyPrefix: "fk:cache:",
    defaultTtlMs: 300_000,
    staleTtlMs: 3_600_000,
    negativeTtlMs: 30_000,
    lockTtlMs: 5_000,
    operationTimeoutMs: 500,
    failureThreshold: 3,
    recoveryTimeoutMs: 30_000,
    mutationWaitMs: 1_000,
  },
  load: {
    maxConcurrent: 16,
    maxWaiters: 100,
    retryAttempts: 3,
    retryDelayMs: 50,
    maxQueuedLoads: 1_000,
  },
  onRedisError: "bypass-l1",
  namespaces: {},
};

const CACHE_MODES: readonly CacheMode[] = ["l1-only", "l2-only", "multi"];

/**
 * @description Construye la configuración interna resuelta a partir de la configuración
 * pública del usuario, aplicando defaults y validando valores inválidos.
 *
 * La validación es deliberadamente estricta: configuraciones numéricas negativas o inválidas
 * se rechazan en el bootstrap en lugar de degradar silenciosamente en runtime.
 *
 * @param userOptions Configuración pública de la caché (`distributed.features.cache`).
 * @returns Configuración resuelta con todos los valores concretos.
 * @throws {Error} Con prefijo "[FastifyKit Cache]" si la configuración es inválida.
 */
export function buildResolvedCacheConfig(
  userOptions?: DistributedCacheOptions,
): ResolvedCacheAdapterConfig {
  if (userOptions === undefined) {
    return cloneResolvedConfig(DEFAULT_RESOLVED_CACHE_CONFIG);
  }

  const resolved: ResolvedCacheAdapterConfig = {
    mode: resolveMode(userOptions.mode, "l1-only"),
    onRedisError: resolveFailurePolicy(
      userOptions.onRedisError,
      "bypass-l1",
      "onRedisError",
    ),
    l1: { ...DEFAULT_RESOLVED_CACHE_CONFIG.l1 },
    l2: { ...DEFAULT_RESOLVED_CACHE_CONFIG.l2 },
    load: { ...DEFAULT_RESOLVED_CACHE_CONFIG.load },
    namespaces: {},
  };

  const { l1, l2, load, namespaces } = userOptions;

  if (l1 !== undefined) {
    resolved.l1.maxSize = resolvePositiveInteger(
      l1.maxSize,
      DEFAULT_RESOLVED_CACHE_CONFIG.l1.maxSize,
      "l1.maxSize",
    );
    resolved.l1.defaultTtlMs = secondsToMs(
      resolvePositiveNumber(
        l1.defaultTtlSeconds,
        DEFAULT_RESOLVED_CACHE_CONFIG.l1.defaultTtlMs / 1000,
        "l1.defaultTtlSeconds",
      ),
    );
  }

  if (l2 !== undefined) {
    if (l2.keyPrefix !== undefined) {
      if (typeof l2.keyPrefix !== "string") {
        throw new Error(
          "[FastifyKit Cache] Configuración inválida: 'l2.keyPrefix' debe ser una cadena.",
        );
      }
      validateCacheKeyPrefix(l2.keyPrefix);
      resolved.l2.keyPrefix = l2.keyPrefix;
    }
    resolved.l2.defaultTtlMs = secondsToMs(
      resolvePositiveNumber(
        l2.defaultTtlSeconds,
        DEFAULT_RESOLVED_CACHE_CONFIG.l2.defaultTtlMs / 1000,
        "l2.defaultTtlSeconds",
      ),
    );
    resolved.l2.staleTtlMs = secondsToMs(
      resolvePositiveNumber(
        l2.staleTtlSeconds,
        DEFAULT_RESOLVED_CACHE_CONFIG.l2.staleTtlMs / 1000,
        "l2.staleTtlSeconds",
      ),
    );
    resolved.l2.negativeTtlMs = secondsToMs(
      resolvePositiveNumber(
        l2.negativeTtlSeconds,
        DEFAULT_RESOLVED_CACHE_CONFIG.l2.negativeTtlMs / 1000,
        "l2.negativeTtlSeconds",
      ),
    );
    resolved.l2.lockTtlMs = resolvePositiveInteger(
      l2.lockTtlMs,
      DEFAULT_RESOLVED_CACHE_CONFIG.l2.lockTtlMs,
      "l2.lockTtlMs",
    );
    resolved.l2.operationTimeoutMs = resolvePositiveInteger(
      l2.operationTimeoutMs,
      DEFAULT_RESOLVED_CACHE_CONFIG.l2.operationTimeoutMs,
      "l2.operationTimeoutMs",
    );
    resolved.l2.failureThreshold = resolvePositiveInteger(
      l2.failureThreshold,
      DEFAULT_RESOLVED_CACHE_CONFIG.l2.failureThreshold,
      "l2.failureThreshold",
    );
    resolved.l2.recoveryTimeoutMs = resolvePositiveInteger(
      l2.recoveryTimeoutMs,
      DEFAULT_RESOLVED_CACHE_CONFIG.l2.recoveryTimeoutMs,
      "l2.recoveryTimeoutMs",
    );
    resolved.l2.mutationWaitMs = resolvePositiveInteger(
      l2.mutationWaitMs,
      DEFAULT_RESOLVED_CACHE_CONFIG.l2.mutationWaitMs,
      "l2.mutationWaitMs",
    );

    if (resolved.l2.staleTtlMs < resolved.l2.defaultTtlMs) {
      throw new Error(
        "[FastifyKit Cache] Configuración inválida: 'l2.staleTtlSeconds' debe ser mayor o igual que 'l2.defaultTtlSeconds' para que la ventana stale tenga sentido.",
      );
    }
  }

  if (load !== undefined) {
    resolved.load.maxConcurrent = resolvePositiveInteger(
      load.maxConcurrent,
      DEFAULT_RESOLVED_CACHE_CONFIG.load.maxConcurrent,
      "load.maxConcurrent",
    );
    resolved.load.maxWaiters = resolvePositiveInteger(
      load.maxWaiters,
      DEFAULT_RESOLVED_CACHE_CONFIG.load.maxWaiters,
      "load.maxWaiters",
    );
    resolved.load.retryAttempts = resolvePositiveInteger(
      load.retryAttempts,
      DEFAULT_RESOLVED_CACHE_CONFIG.load.retryAttempts,
      "load.retryAttempts",
    );
    resolved.load.retryDelayMs = resolveNonNegativeNumber(
      load.retryDelayMs,
      DEFAULT_RESOLVED_CACHE_CONFIG.load.retryDelayMs,
      "load.retryDelayMs",
    );
    resolved.load.maxQueuedLoads = resolvePositiveInteger(
      load.maxQueuedLoads,
      DEFAULT_RESOLVED_CACHE_CONFIG.load.maxQueuedLoads,
      "load.maxQueuedLoads",
    );
  }

  if (namespaces !== undefined) {
    for (const [namespace, nsOptions] of Object.entries(namespaces)) {
      try {
        validateCacheNamespace(namespace);
      } catch (error) {
        throw new Error(
          `[FastifyKit Cache] Configuración inválida para namespace '${namespace}'.`,
          { cause: error },
        );
      }
      resolved.namespaces[namespace] = {
        mode: resolveMode(nsOptions.mode, resolved.mode),
        allowStale: nsOptions.allowStale ?? true,
        onRedisError: resolveFailurePolicy(
          nsOptions.onRedisError,
          resolved.onRedisError,
          `namespaces["${namespace}"].onRedisError`,
        ),
        l1TtlMs:
          nsOptions.l1TtlSeconds === undefined
            ? null
            : secondsToMs(
                resolvePositiveNumber(
                  nsOptions.l1TtlSeconds,
                  0,
                  `namespaces["${namespace}"].l1TtlSeconds`,
                ),
              ),
        l2TtlMs:
          nsOptions.l2TtlSeconds === undefined
            ? null
            : secondsToMs(
                resolvePositiveNumber(
                  nsOptions.l2TtlSeconds,
                  0,
                  `namespaces["${namespace}"].l2TtlSeconds`,
                ),
              ),
        staleTtlMs:
          nsOptions.staleTtlSeconds === undefined
            ? null
            : secondsToMs(
                resolvePositiveNumber(
                  nsOptions.staleTtlSeconds,
                  0,
                  `namespaces["${namespace}"].staleTtlSeconds`,
                ),
              ),
      };

      const namespaceConfig = resolved.namespaces[namespace];
      const effectiveL2Ttl =
        namespaceConfig.l2TtlMs ?? resolved.l2.defaultTtlMs;
      const effectiveStaleTtl =
        namespaceConfig.staleTtlMs ?? resolved.l2.staleTtlMs;
      if (effectiveStaleTtl < effectiveL2Ttl) {
        throw new Error(
          `[FastifyKit Cache] Configuración inválida: namespace '${namespace}' requiere staleTtlSeconds >= l2TtlSeconds.`,
        );
      }
    }
  }

  return resolved;
}

/**
 * Calcula las capas necesarias considerando el modo global y todos los
 * overrides por namespace. La factory debe materializar esta unión, no solo
 * el modo global, para evitar degradaciones silenciosas.
 */
export function getCacheLayerRequirements(
  config: ResolvedCacheAdapterConfig,
): CacheLayerRequirements {
  const modes = [
    config.mode,
    ...Object.values(config.namespaces).map((namespace) => namespace.mode),
  ];
  return {
    needsL1: modes.some((mode) => mode !== "l2-only"),
    needsL2: modes.some((mode) => mode !== "l1-only"),
  };
}

/**
 * @description Devuelve una copia profunda (1 nivel) de la configuración resuelta.
 * Evita que el caller pueda mutar los defaults globales compartidos.
 */
function cloneResolvedConfig(
  config: ResolvedCacheAdapterConfig,
): ResolvedCacheAdapterConfig {
  return {
    mode: config.mode,
    onRedisError: config.onRedisError,
    l1: { ...config.l1 },
    l2: { ...config.l2 },
    load: { ...config.load },
    namespaces: {},
  };
}

function resolveMode(
  mode: CacheMode | undefined,
  fallback: CacheMode,
): CacheMode {
  if (mode === undefined) return fallback;
  if (!CACHE_MODES.includes(mode)) {
    throw new Error(
      `[FastifyKit Cache] Configuración inválida: modo de caché '${String(mode)}' no soportado. Valores válidos: ${CACHE_MODES.join(", ")}.`,
    );
  }
  return mode;
}

function resolveFailurePolicy(
  policy: string | undefined,
  fallback: CacheRedisFailurePolicy,
  path: string,
): CacheRedisFailurePolicy {
  if (policy === undefined) return fallback;
  if (
    policy !== "bypass-l1" &&
    policy !== "stale-if-error" &&
    policy !== "fail"
  ) {
    throw new Error(
      `[FastifyKit Cache] Configuración inválida: '${path}' debe ser 'bypass-l1', 'stale-if-error' o 'fail'. Recibido: ${String(policy)}.`,
    );
  }
  return policy;
}

function resolvePositiveNumber(
  value: number | undefined,
  fallback: number,
  path: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `[FastifyKit Cache] Configuración inválida: '${path}' debe ser un número positivo. Recibido: ${String(value)}.`,
    );
  }
  return value;
}

function resolveNonNegativeNumber(
  value: number | undefined,
  fallback: number,
  path: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(
      `[FastifyKit Cache] Configuración inválida: '${path}' debe ser un número mayor o igual a cero. Recibido: ${String(value)}.`,
    );
  }
  return value;
}

function resolvePositiveInteger(
  value: number | undefined,
  fallback: number,
  path: string,
): number {
  const resolved = resolvePositiveNumber(value, fallback, path);
  if (!Number.isInteger(resolved)) {
    throw new Error(
      `[FastifyKit Cache] Configuración inválida: '${path}' debe ser un entero positivo. Recibido: ${String(resolved)}.`,
    );
  }
  return resolved;
}

function secondsToMs(seconds: number): number {
  return seconds * 1000;
}

function validateCacheKeyPrefix(prefix: string): void {
  if (
    prefix.length === 0 ||
    prefix.length > 256 ||
    /[\u0000-\u001f\u007f*?\[\]]/.test(prefix) ||
    prefix !== prefix.trim()
  ) {
    throw new Error(
      "[FastifyKit Cache] Configuración inválida: 'l2.keyPrefix' debe tener entre 1 y 256 caracteres, no contener espacios externos, caracteres de control ni patrones glob de Redis (*, ?, [ o ]).",
    );
  }
}
