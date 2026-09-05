/**
 * @description Modos de operación de la caché de FastifyKit.
 *
 * - "l1-only": Solo caché en memoria local del proceso. Es el comportamiento actual del framework
 *   y NO requiere Redis. Cualquier instancia tiene su propia copia, sin sincronización.
 * - "l2-only": Solo caché en Redis, compartida entre todas las instancias conectadas al mismo servidor.
 *   Requiere `distributed.redis`.
 * - "multi": Caché multicapa: L1 en memoria local + L2 en Redis, con coherencia distribuida
 *   (invalidación por Pub/Sub y versionado por namespace). Requiere `distributed.redis`.
 */
export type CacheMode = "l1-only" | "l2-only" | "multi";

/**
 * Política aplicada cuando el backend Redis no está disponible.
 *
 * - `bypass-l1`: no sirve caché local potencialmente divergente; ejecuta el
 *   loader y no escribe caché mientras Redis está degradado.
 * - `stale-if-error`: permite servir L1 dentro de su deadline stale explícito.
 * - `fail`: propaga un error tipado de dependencia no disponible.
 */
export type CacheRedisFailurePolicy = "bypass-l1" | "stale-if-error" | "fail";

/**
 * @description Configuración de la capa L1 (en memoria, local al proceso).
 */
export interface DistributedCacheL1Options {
  /**
   * Número máximo de entradas que puede contener la caché L1.
   * Al superar el límite se descartan las entradas menos recientemente usadas (LRU).
   * @default 10000
   */
  maxSize?: number;
  /**
   * TTL por defecto en segundos para las entradas L1 cuando la operación no especifica uno.
   * @default 60
   */
  defaultTtlSeconds?: number;
}

/**
 * @description Configuración de la capa L2 (Redis, compartida entre instancias).
 */
export interface DistributedCacheL2Options {
  /**
   * Prefijo de todas las claves L2 en Redis.
   * Es la frontera de aislamiento entre aplicaciones, entornos y tenants que
   * comparten un mismo Redis. Debe ser único por ámbito; el default existe por
   * compatibilidad y no garantiza aislamiento entre aplicaciones.
   * @default "fk:cache:"
   */
  keyPrefix?: string;
  /**
   * TTL fresco por defecto en segundos para las entradas L2.
   * Dentro de esta ventana la entrada se considera "fresh" y se sirve sin validación adicional.
   * @default 300
   */
  defaultTtlSeconds?: number;
  /**
   * TTL máximo en segundos durante el cual una entrada L2 puede servirse como "stale"
   * mientras se refresca en segundo plano (stale-while-revalidate), contado
   * desde la escritura y no sumado al TTL fresco.
   * Debe ser mayor o igual que `defaultTtlSeconds` cuando se usa `allowStale`.
   * @default 3600
   */
  staleTtlSeconds?: number;
  /**
   * TTL en segundos para las entradas de caché negativa (resultados vacíos o 404).
   * Es deliberadamente corto para evitar servir misses obsoletos durante mucho tiempo.
   * @default 30
   */
  negativeTtlSeconds?: number;
  /**
   * TTL de los locks distribuidos en milisegundos (anti thundering herd).
   * @default 5000
   */
  lockTtlMs?: number;
  /**
   * Tiempo máximo que una operación de caché puede esperar una respuesta Redis.
   * @default 500
   */
  operationTimeoutMs?: number;
  /** Número de fallos consecutivos antes de abrir el circuito local Redis. @default 3 */
  failureThreshold?: number;
  /** Tiempo en milisegundos antes de permitir una probe half-open. @default 30000 */
  recoveryTimeoutMs?: number;
  /** Tiempo máximo esperando un lock para mutaciones explícitas. @default 1000 */
  mutationWaitMs?: number;
}

/**
 * @description Configuración del proceso de carga hacia la fuente de datos (loader).
 */
export interface DistributedCacheLoadOptions {
  /**
   * Límite máximo de cargas simultáneas hacia la fuente de datos.
   * Protege la base de datos ante picos de misses simultáneos.
   * @default 16
   */
  maxConcurrent?: number;
  /**
   * Número máximo de llamadas que pueden esperar a que una carga en curso termine
   * antes de resolver con un fallback controlado (en vez de acumular esperas ilimitadas).
   * @default 100
   */
  maxWaiters?: number;
  /**
   * Intentos de reintento al volver a consultar L2 tras no poder adquirir el lock de carga.
   * @default 3
   */
  retryAttempts?: number;
  /**
   * Retardo base en milisegundos entre reintentos. Se aplica jitter para evitar sincronización entre instancias.
   * @default 50
   */
  retryDelayMs?: number;
  /**
   * Límite global de loaders esperando un slot. Evita crecimiento de memoria
   * ilimitado durante una degradación de Redis o una avalancha de claves frías.
   * @default 1000
   */
  maxQueuedLoads?: number;
}

/**
 * @description Configuración de la caché para un namespace específico.
 * Sobrescribe los valores globales únicamente para las claves cuyo namespace coincida.
 */
export interface DistributedCacheNamespaceOptions {
  /**
   * Modo de operación para este namespace.
   * Si no se define, hereda el modo global.
   */
  mode?: CacheMode;
  /**
   * Permite servir entradas "stale" mientras se refrescan en segundo plano.
   * Solo tiene efecto cuando el modo del namespace involucra L2 ("l2-only" o "multi").
   * @default true
   */
  allowStale?: boolean;
  /**
   * TTL en segundos para las entradas L1 de este namespace.
   * Si no se define, usa el default global de L1.
   */
  l1TtlSeconds?: number;
  /**
   * TTL fresco en segundos para las entradas L2 de este namespace.
   * Si no se define, usa el default global de L2.
   */
  l2TtlSeconds?: number;
  /** TTL total de servicio (fresh + stale) para L2 de este namespace. */
  staleTtlSeconds?: number;
  /** Política cuando Redis falla para este namespace. */
  onRedisError?: CacheRedisFailurePolicy;
}

/**
 * @description Configuración pública de la caché distribuida de FastifyKit.
 *
 * Semántica de activación:
 * - Si no se configura esta opción, la caché opera en modo "l1-only" (comportamiento actual).
 * - Los modos "l2-only" y "multi" requieren `distributed.redis`; el bootstrap fallará con
 *   un error accionable si se piden sin conexión configurada.
 * - La presencia de `distributed.redis` NO activa la caché distribuida por sí sola:
 *   el modo debe declararse explícitamente aquí.
 *
 * Ejemplo:
 * ```typescript
 * distributed: {
 *   redis: { host: "localhost", port: 6379 },
 *   features: {
 *     cache: {
 *       mode: "multi",
 *       l1: { maxSize: 5000, defaultTtlSeconds: 30 },
 *       l2: { keyPrefix: "app:cache:", defaultTtlSeconds: 300, staleTtlSeconds: 3600 },
 *       load: { maxConcurrent: 16, maxQueuedLoads: 1000 },
 *       namespaces: {
 *         "sessions": { mode: "l2-only", l2TtlSeconds: 1800 }
 *       }
 *     }
 *   }
 * }
 * ```
 */
export interface DistributedCacheOptions {
  /**
   * Modo global de la caché. Los namespaces pueden sobrescribirlo individualmente.
   * @default "l1-only"
   */
  mode?: CacheMode;
  /** Política Redis por defecto para todos los namespaces. @default "bypass-l1" */
  onRedisError?: CacheRedisFailurePolicy;
  /**
   * Configuración de la capa L1 (en memoria).
   */
  l1?: DistributedCacheL1Options;
  /**
   * Configuración de la capa L2 (Redis).
   */
  l2?: DistributedCacheL2Options;
  /**
   * Configuración del proceso de carga hacia la fuente de datos.
   */
  load?: DistributedCacheLoadOptions;
  /**
   * Configuración por namespace. Las claves del objeto son los namespaces de la caché
   * (el primer segmento de la clave, ej: el "users" de "users:getUser:123").
   */
  namespaces?: Record<string, DistributedCacheNamespaceOptions>;
}
