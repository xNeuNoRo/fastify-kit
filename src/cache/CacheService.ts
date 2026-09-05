import { getLogger } from "../logger/logger.factory.js";
import { container } from "../container/DIContainer.js";
import type {
  CacheMode,
  CacheRedisFailurePolicy,
} from "../core/interfaces/cache.interface.js";
import { BeforeApplicationShutdown } from "../core/interfaces/lifecycle.interface.js";
import {
  CACHE_ADAPTER_TOKEN,
  type CacheAdapter,
  type CacheEnvelope,
} from "./interfaces/CacheAdapter.js";
import { releaseApplicationResource } from "../core/application-context.js";
import type { ResolvedCacheAdapterConfig } from "./interfaces/CacheConfig.js";
import {
  NOOP_CACHE_METRICS,
  type CacheMetrics,
} from "./interfaces/CacheMetrics.js";
import { CacheRedisCircuit } from "./redis/CacheRedisCircuit.js";
import {
  CacheDependencyUnavailableError,
  CacheLoadShedError,
  CacheMutationUnavailableError,
} from "./errors.js";
import type {
  CacheLock,
  CacheInvalidationMessage,
  DistributedCacheAdapter,
} from "./interfaces/DistributedCacheAdapter.js";
import { CacheCodecError } from "./redis/CacheEnvelopeCodec.js";
import {
  createCacheEnvelope,
  getEnvelopeFreshness,
  isEnvelopeExpired,
  type CacheLookup,
} from "./interfaces/CacheResult.js";
import {
  extractCacheNamespace,
  hashCacheKey,
  validateCacheNamespace,
} from "./namespace.js";

type CacheLifecycleState =
  | "idle"
  | "starting"
  | "started"
  | "closing"
  | "closed";

/**
 * @description Opciones de construcción del CacheService.
 */
export interface CacheServiceOptions {
  /** Capa L1 (memoria local). Ausente en modo "l2-only". */
  l1?: CacheAdapter;
  /** Capa L2 (Redis). Ausente en modo "l1-only". */
  l2?: DistributedCacheAdapter;
  /** Configuración resuelta de la caché. */
  config: ResolvedCacheAdapterConfig;
  /**
   * Métricas de caché. Por defecto no-op: la observabilidad es opt-in y
   * nunca altera el resultado funcional de las operaciones.
   */
  metrics?: CacheMetrics;
}

/**
 * @description Opciones por llamada de `getOrLoad`.
 *
 * @example
 * const options: CacheServiceGetOrLoadOptions = {
 *   ttlSeconds: 60,
 *   allowStale: true,
 * };
 */
export interface CacheServiceGetOrLoadOptions {
  /**
   * TTL fresco en segundos (sobrescribe el default del namespace). El TTL
   * total stale se eleva automáticamente si este valor lo supera.
   * Si no se provee o es <= 0, se usa el TTL del namespace/policy.
   */
  ttlSeconds?: number;
  /**
   * Permite servir entradas stale mientras se refrescan en segundo plano.
   * Sobrescribe el valor del namespace para esta llamada.
   */
  allowStale?: boolean;
}

/**
 * @description Policy efectiva de un namespace (global + namespace + llamada).
 */
interface CachePolicy {
  mode: CacheMode;
  allowStale: boolean;
  l1TtlMs: number;
  l2TtlMs: number;
  staleTtlMs: number;
  onRedisError: CacheRedisFailurePolicy;
}

type CacheLoader<T> = () => Promise<T>;

/**
 * @description Orquestador multi-capa de la caché. Implementa el flujo aprobado:
 *
 * ```
 * L1 fresh hit -> responder
 * L1 miss/stale -> L2
 * L2 fresh hit -> guardar L1 -> responder
 * L2 stale + allowStale -> refresco asíncrono (lock) -> servir stale
 * MISS -> lock distribuido -> comprobación doble -> cargador -> guardar L2+L1
 *         lock ocupado -> retry con backoff+jitter -> fallback controlado
 * ```
 *
 * Garantías y límites:
 * - In-flight dedupe local: llamadas concurrentes del MISMO key comparten una
 *   única carga (hasta `load.maxWaiters`; las excedentes ejecutan un fallback
 *   controlado con duplicación acotada).
 * - Semáforo `load.maxConcurrent`: limita los cargadores simultáneos hacia la fuente.
 * - Lock distribuido con expiración: un cargador que tarde más que el TTL del lock
 *   puede duplicarse en otra instancia (nunca deadlock).
 * - Caché negativa (`null`/`undefined` del cargador) solo con L2 y TTL corto.
 * - Los errores del refresco en segundo plano se registran; nunca quedan como
 *   rechazos de promesas no controlados.
 * - La invalidación entrante solo toca el L1 local (sin loops de publicación).
 */
export class CacheService implements CacheAdapter, BeforeApplicationShutdown {
  private readonly l1?: CacheAdapter;
  private readonly l2?: DistributedCacheAdapter;
  private readonly config: ResolvedCacheAdapterConfig;
  private readonly metrics: CacheMetrics;
  private readonly logger = getLogger();
  private readonly redisCircuit?: CacheRedisCircuit;

  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly inFlightWaiters = new Map<string, number>();
  private activeLoads = 0;
  private readonly loadQueue: Array<() => void> = [];
  private readonly refreshes = new Set<string>();
  private readonly mutations = new Map<string, Promise<void>>();
  private readonly activeOperations = new Set<Promise<unknown>>();

  private lifecycleState: CacheLifecycleState = "idle";
  private startPromise?: Promise<void>;
  private closePromise?: Promise<void>;
  private unsubscribe?: () => Promise<void>;

  constructor(options: CacheServiceOptions) {
    this.l1 = options.l1;
    this.l2 = options.l2;
    this.config = options.config;
    this.metrics = options.metrics ?? NOOP_CACHE_METRICS;
    if (this.l2) {
      this.redisCircuit = new CacheRedisCircuit(
        this.config.l2.failureThreshold,
        this.config.l2.recoveryTimeoutMs,
        this.metrics,
      );
    }
  }

  // ==========================================================================
  // Ciclo de vida
  // ==========================================================================

  /**
   * @description Suscribe las invalidaciones distribuidas para limpiar el L1 local.
   * Idempotente. Sin L2 no hace nada.
   */
  async start(): Promise<void> {
    if (this.lifecycleState === "closing" || this.lifecycleState === "closed") {
      throw new Error(
        "[FastifyKit Cache] No se puede iniciar una caché cerrada.",
      );
    }
    if (!this.l2) {
      this.lifecycleState = "started";
      return;
    }
    if (this.lifecycleState === "started") return;
    if (this.lifecycleState === "starting" && this.startPromise) {
      return this.startPromise;
    }
    this.lifecycleState = "starting";
    const initialization = (async () => {
      try {
        this.unsubscribe = await this.l2!.subscribeInvalidation((message) =>
          this.handleInvalidation(message),
        );
        this.lifecycleState = "started";
      } catch (error) {
        // Una suscripción fallida debe dejar la instancia lista para reintentar.
        this.unsubscribe = undefined;
        this.lifecycleState = "idle";
        throw error;
      }
    })();
    this.startPromise = initialization;
    try {
      await initialization;
    } finally {
      if (this.startPromise === initialization) this.startPromise = undefined;
    }
  }

  /**
   * @description Detiene la suscripción y cierra las capas (no la conexión
   * Redis compartida, que pertenece a RedisConnectionManager).
   */
  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    if (this.lifecycleState === "closed") return;

    this.lifecycleState = "closing";
    const closing = (async () => {
      // No pueden iniciarse nuevas cargas públicas ni refrescos en segundo plano
      // después de pasar al estado de cierre. Las cargas existentes pueden terminar
      // porque el contrato del cargador no tiene señal de cancelación.
      while (this.activeOperations.size > 0) {
        await Promise.allSettled([...this.activeOperations]);
      }
      if (this.startPromise) await this.startPromise.catch(() => {});

      const unsubscribe = this.unsubscribe;
      this.unsubscribe = undefined;
      if (unsubscribe) await unsubscribe().catch(() => {});

      const results = await Promise.allSettled([
        this.l1?.close?.(),
        this.l2?.close?.(),
      ]);
      if (container.has(CACHE_ADAPTER_TOKEN)) {
        try {
          if (container.resolve(CACHE_ADAPTER_TOKEN) === this) {
            container.unregister(CACHE_ADAPTER_TOKEN);
          }
        } catch {
          // El contenedor puede haber sido restablecido por un test de integración.
        }
      }
      releaseApplicationResource(this);
      this.lifecycleState = "closed";
      const failure = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      if (failure) throw failure.reason;
    })();
    this.closePromise = closing;
    await closing;
  }

  /**
   * @description Hook de ciclo de vida del framework: cierra el suscriptor de
   * invalidaciones y las capas al apagar la aplicación.
   */
  async beforeApplicationShutdown(): Promise<void> {
    await this.close();
  }

  // ==========================================================================
  // Operación principal: get-or-load
  // ==========================================================================

  /**
   * @description Obtiene un valor de la caché, cargándolo con el `loader` si
   * no existe una entrada servible (miss o stale sin allowStale).
   *
   * - Un cargador que devuelve `null`/`undefined` produce caché negativa (solo con L2).
   * - El resultado se almacena en las capas según el modo del namespace.
   *
   * @throws Si el cargador falla y no hay dato servible, el error se propaga al código llamador.
   */
  async getOrLoad<T>(
    key: string,
    loader: CacheLoader<T>,
    options?: CacheServiceGetOrLoadOptions,
  ): Promise<T> {
    return this.trackOperation(() =>
      this.getOrLoadInternal(key, loader, options),
    );
  }

  private async getOrLoadInternal<T>(
    key: string,
    loader: CacheLoader<T>,
    options?: CacheServiceGetOrLoadOptions,
  ): Promise<T> {
    if (this.lifecycleState === "closing" || this.lifecycleState === "closed") {
      throw new Error("[FastifyKit Cache] La caché está cerrándose.");
    }
    const namespace = extractCacheNamespace(key);
    const policy = this.resolvePolicy(namespace, options);

    let read: CacheLookup<T>;
    try {
      read = await this.readThrough<T>(key, policy);
    } catch (error) {
      if (!this.isRedisFailure(error)) throw error;
      return this.loadAfterRedisFailure(key, loader, policy);
    }

    if (read.status === "negative" || read.status === "fresh") {
      return read.envelope!.value as T;
    }
    if (read.status === "stale" && policy.allowStale) {
      this.refreshInBackground(key, loader, policy);
      return read.envelope!.value;
    }

    return this.loadThrough(key, loader, policy);
  }

  // ==========================================================================
  // CacheAdapter (contrato de almacén para CacheManager y adaptadores personalizados)
  // ==========================================================================

  async get<T>(key: string): Promise<CacheEnvelope<T> | null> {
    const namespace = extractCacheNamespace(key);
    const policy = this.resolvePolicy(namespace);

    if (
      (policy.mode === "l1-only" || policy.mode === "multi") &&
      !this.mustBypassL1(policy)
    ) {
      const l1Envelope = await this.l1?.get<T>(key);
      if (l1Envelope) {
        this.metrics.onRead("l1_hit");
        return l1Envelope;
      }
    }

    if (policy.mode === "l2-only" || policy.mode === "multi") {
      try {
        const l2Envelope = await this.redisCall("get", () =>
          this.l2!.get<T>(key),
        );
        if (l2Envelope) {
          if (policy.mode === "multi") {
            await this.populateL1(key, l2Envelope, policy);
          }
          this.metrics.onRead("l2_hit");
          return l2Envelope;
        }
      } catch (error) {
        if (!this.isRedisFailure(error)) throw error;
        this.metrics.onFallback?.(policy.onRedisError);
        if (policy.onRedisError === "fail") throw error;
        if (policy.onRedisError === "bypass-l1") return null;
      }
    }

    this.metrics.onRead("miss");
    return null;
  }

  /**
   * @description Escritura explícita de un envelope (CacheManager.set / API de usuario).
   * En modos con L2, publica la invalidación para que las demás instancias limpien
   * su L1 local. Las cargas internas (cargadores) NO pasan por aquí ni publican.
   */
  async set<T>(key: string, envelope: CacheEnvelope<T>): Promise<void> {
    const namespace = extractCacheNamespace(key);
    const policy = this.resolvePolicy(namespace);

    await this.withMutation(key, async () => {
      if (policy.mode === "l1-only") {
        await this.l1?.set(key, envelope);
        return;
      }
      if (!this.l2) throw new CacheDependencyUnavailableError("set");

      const lock = await this.acquireMutationLock(key);
      try {
        const namespaceVersion = await this.redisCall("get_version", () =>
          this.l2!.getVersion(namespace),
        );
        const fencedEnvelope = {
          ...envelope,
          namespaceVersion,
        };
        const persisted = await this.redisCall("set", () =>
          this.l2!.setWhileHoldingLock(key, fencedEnvelope, lock),
        );
        if (!persisted) throw new CacheMutationUnavailableError();
        if (policy.mode === "multi") {
          await this.l1?.set(key, fencedEnvelope);
        }
        await this.redisCall("publish_invalidation", () =>
          this.l2!.publishInvalidation({
            namespace,
            namespaceVersion,
            keys: [key],
          }),
        );
      } finally {
        await this.releaseMutationLock(lock);
      }
    });
  }

  async delete(key: string): Promise<void> {
    const namespace = extractCacheNamespace(key);
    const policy = this.resolvePolicy(namespace);

    await this.withMutation(key, async () => {
      if (policy.mode === "l1-only") {
        await this.l1?.delete(key);
        return;
      }
      if (!this.l2) throw new CacheDependencyUnavailableError("delete");

      const lock = await this.acquireMutationLock(key);
      try {
        const deleted = await this.redisCall("delete", () =>
          this.l2!.deleteWhileHoldingLock(key, lock),
        );
        if (!deleted) throw new CacheMutationUnavailableError();
        await this.l1?.delete(key);
        const namespaceVersion = await this.redisCall("get_version", () =>
          this.l2!.getVersion(namespace),
        );
        await this.redisCall("publish_invalidation", () =>
          this.l2!.publishInvalidation({
            namespace,
            namespaceVersion,
            keys: [key],
          }),
        );
      } finally {
        await this.releaseMutationLock(lock);
      }
    });
  }

  async clearNamespace(namespace: string): Promise<void> {
    validateCacheNamespace(namespace);
    const policy = this.resolvePolicy(namespace);
    if (this.l1 && policy.mode !== "l2-only") {
      await this.l1.clearNamespace(namespace);
    }
    if (this.l2 && policy.mode !== "l1-only") {
      await this.redisCall("clear_namespace", () =>
        this.l2!.clearNamespace(namespace),
      );
    }
  }

  async clearAll(): Promise<void> {
    await this.l1?.clearAll();
    if (this.l2) {
      await this.redisCall("clear_all", () => this.l2!.clearAll());
    }
  }

  async getVersion(namespace: string): Promise<number> {
    this.validateVersionNamespace(namespace);
    const policy =
      namespace === "*" ? undefined : this.resolvePolicy(namespace);
    if (this.l2 && (namespace === "*" || policy?.mode !== "l1-only"))
      return this.redisCall("get_version", () =>
        this.l2!.getVersion(namespace),
      );
    return this.l1?.getVersion(namespace) ?? 0;
  }

  async setVersion(namespace: string, version: number): Promise<void> {
    this.validateVersionNamespace(namespace);
    if (!Number.isSafeInteger(version) || version < 0) {
      throw new Error(
        "[FastifyKit Cache] La versión del namespace debe ser un entero seguro no negativo.",
      );
    }
    const policy =
      namespace === "*" ? undefined : this.resolvePolicy(namespace);
    if (this.l1 && (namespace === "*" || policy?.mode !== "l2-only")) {
      await this.l1.setVersion(namespace, version);
    }
    if (this.l2 && (namespace === "*" || policy?.mode !== "l1-only")) {
      await this.redisCall("set_version", () =>
        this.l2!.setVersion(namespace, version),
      );
    }
  }

  // ==========================================================================
  // Internos
  // ==========================================================================

  private resolvePolicy(
    namespace: string,
    options?: CacheServiceGetOrLoadOptions,
  ): CachePolicy {
    if (
      options?.ttlSeconds !== undefined &&
      !Number.isFinite(options.ttlSeconds)
    ) {
      throw new Error(
        "[FastifyKit Cache] 'ttlSeconds' debe ser un número finito.",
      );
    }
    const nsConfig = this.config.namespaces[namespace];
    const ttlOverride =
      options?.ttlSeconds !== undefined && options.ttlSeconds > 0
        ? options.ttlSeconds * 1000
        : undefined;
    return {
      mode: nsConfig?.mode ?? this.config.mode,
      allowStale: options?.allowStale ?? nsConfig?.allowStale ?? true,
      l1TtlMs: ttlOverride ?? nsConfig?.l1TtlMs ?? this.config.l1.defaultTtlMs,
      l2TtlMs: ttlOverride ?? nsConfig?.l2TtlMs ?? this.config.l2.defaultTtlMs,
      staleTtlMs:
        ttlOverride === undefined
          ? (nsConfig?.staleTtlMs ?? this.config.l2.staleTtlMs)
          : Math.max(
              ttlOverride,
              nsConfig?.staleTtlMs ?? this.config.l2.staleTtlMs,
            ),
      onRedisError: nsConfig?.onRedisError ?? this.config.onRedisError,
    };
  }

  private async readThrough<T>(
    key: string,
    policy: CachePolicy,
  ): Promise<CacheLookup<T>> {
    if (this.mustBypassL1(policy)) {
      throw new CacheDependencyUnavailableError("read");
    }

    if (policy.mode === "l1-only" || policy.mode === "multi") {
      const l1Envelope = await this.l1?.get<T>(key);
      if (l1Envelope) {
        if (l1Envelope.isNegative) {
          this.metrics.onRead("negative_hit");
          return { status: "negative", envelope: l1Envelope };
        }
        if (getEnvelopeFreshness(l1Envelope) === "fresh") {
          this.metrics.onRead("l1_hit");
          return { status: "fresh", envelope: l1Envelope };
        }
        if (policy.mode === "l1-only" && policy.allowStale) {
          this.metrics.onRead("l1_stale");
          return { status: "stale", envelope: l1Envelope };
        }
        // L1 stale en modo multi: el L2 puede tener datos más frescos.
      }
    }

    if (policy.mode === "l2-only" || policy.mode === "multi") {
      const l2Envelope = await this.redisCall("get", () =>
        this.l2!.get<T>(key),
      );
      if (l2Envelope) {
        if (l2Envelope.isNegative) {
          await this.populateL1(key, l2Envelope, policy);
          this.metrics.onRead("negative_hit");
          return { status: "negative", envelope: l2Envelope };
        }
        if (getEnvelopeFreshness(l2Envelope) === "fresh") {
          await this.populateL1(key, l2Envelope, policy);
          this.metrics.onRead("l2_hit");
          return { status: "fresh", envelope: l2Envelope };
        }
        if (policy.allowStale) {
          await this.populateL1(key, l2Envelope, policy);
          this.metrics.onRead("l2_stale");
          return { status: "stale", envelope: l2Envelope };
        }
      }
    }

    this.metrics.onRead("miss");
    return { status: "miss", envelope: null };
  }

  private async loadThrough<T>(
    key: string,
    loader: CacheLoader<T>,
    policy: CachePolicy,
  ): Promise<T> {
    try {
      if (this.l2 && (policy.mode === "l2-only" || policy.mode === "multi")) {
        return await this.loadWithDistributedLock(key, loader, policy);
      }
      return await this.executeLoader(key, loader, policy);
    } catch (error) {
      if (!this.isRedisFailure(error)) throw error;
      return this.loadAfterRedisFailure(key, loader, policy);
    }
  }

  private async loadAfterRedisFailure<T>(
    key: string,
    loader: CacheLoader<T>,
    policy: CachePolicy,
  ): Promise<T> {
    this.metrics.onFallback?.(policy.onRedisError);

    if (policy.onRedisError === "fail") {
      throw new CacheDependencyUnavailableError("read");
    }

    if (policy.onRedisError === "stale-if-error" && this.l1) {
      const local = await this.l1.get<T>(key);
      if (local) {
        const freshness = getEnvelopeFreshness(local);
        if (local.isNegative || freshness === "fresh") {
          this.metrics.onRead(local.isNegative ? "negative_hit" : "l1_hit");
          return local.value as T;
        }
        if (policy.allowStale && freshness === "stale") {
          this.metrics.onRead("l1_stale");
          this.refreshInBackground(key, loader, policy);
          return local.value as T;
        }
      }
    }

    const loadVersion = await this.l1?.getVersion(extractCacheNamespace(key));
    const value = await this.executeLoader(key, loader, policy, false);
    if (policy.onRedisError === "stale-if-error") {
      await this.storeL1Only(key, value, policy, undefined, loadVersion);
    }
    return value;
  }

  private async redisCall<T>(
    operation: string,
    action: () => Promise<T>,
  ): Promise<T> {
    if (!this.redisCircuit || !this.redisCircuit.allowRequest()) {
      throw new CacheDependencyUnavailableError(operation);
    }

    try {
      const previousState = this.redisCircuit.currentState;
      const startedAt = performance.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let result: T;
      try {
        result = await Promise.race([
          action(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Redis cache operation timed out.")),
              this.config.l2.operationTimeoutMs,
            );
          }),
        ]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        this.metrics.onRedisDuration?.(
          operation,
          Math.max(0, (performance.now() - startedAt) / 1000),
        );
      }
      this.redisCircuit.recordSuccess();
      this.metrics.onRedisOperation?.(operation, "success");
      if (previousState !== "healthy") await this.clearL1OnRecovery();
      return result;
    } catch (error) {
      if (error instanceof CacheCodecError) throw error;
      this.redisCircuit.recordFailure();
      this.metrics.onRedisOperation?.(operation, "error");
      this.logger.error(
        `[FastifyKit Cache] Redis operation failed (${operation}); entering degraded mode when threshold is reached.`,
      );
      throw new CacheDependencyUnavailableError(operation, {
        cause: error,
      });
    }
  }

  private isRedisFailure(
    error: unknown,
  ): error is CacheDependencyUnavailableError {
    return error instanceof CacheDependencyUnavailableError;
  }

  private mustBypassL1(policy: CachePolicy): boolean {
    return (
      this.l2 !== undefined &&
      (policy.mode === "multi" || policy.mode === "l2-only") &&
      policy.onRedisError !== "stale-if-error" &&
      this.redisCircuit?.currentState !== "healthy"
    );
  }

  private async loadWithDistributedLock<T>(
    key: string,
    loader: CacheLoader<T>,
    policy: CachePolicy,
  ): Promise<T> {
    const lockKey = key;
    const lock = await this.redisCall("acquire_lock", () =>
      this.l2!.tryAcquireLock(lockKey, this.config.l2.lockTtlMs),
    );

    if (lock) {
      try {
        // Comprobación doble: otra instancia pudo cargar mientras esperábamos el lock.
        const existing = await this.redisCall("get", () =>
          this.l2!.get<T>(key),
        );
        if (this.isServable(existing)) {
          await this.populateL1(key, existing, policy);
          return existing.value;
        }
        return await this.executeLoader(key, loader, policy, true, lock);
      } finally {
        await this.redisCall("release_lock", () =>
          this.l2!.releaseLock(lock),
        ).catch((error) => {
          this.logger.warn(
            `[FastifyKit Cache] Error liberando el lock (keyHash=${hashCacheKey(key)}): ${
              (error as Error).message
            }`,
          );
        });
      }
    }

    this.metrics.onLockContention();

    // Lock ocupado: reintentos limitados con backoff + jitter.
    for (
      let attempt = 1;
      attempt <= this.config.load.retryAttempts;
      attempt++
    ) {
      await this.sleep(this.jitteredDelay(attempt));
      const retry = await this.redisCall("get", () => this.l2!.get<T>(key));
      if (this.isServable(retry)) {
        await this.populateL1(key, retry, policy);
        return retry.value;
      }
    }

    // Fallback controlado: nadie cargó el dato; cargar localmente (duplicación aceptada).
    // Sin token de fencing no se escribe: el cargador puede completar después de
    // una mutación o de que otra instancia haya tomado el lock.
    return this.executeLoader(key, loader, policy, false);
  }

  /**
   * @description Ejecuta el cargador con deduplicación de operaciones en curso
   * (misma clave) y semáforo `maxConcurrent` (cargas simultáneas hacia la fuente).
   */
  private executeLoader<T>(
    key: string,
    loader: CacheLoader<T>,
    policy: CachePolicy,
    cacheResult = true,
    writeLock?: import("./interfaces/DistributedCacheAdapter.js").CacheLock,
  ): Promise<T> {
    const loadVersion = this.captureLoadVersion(
      key,
      policy,
      writeLock !== undefined,
    );
    const existing = this.inFlight.get(key);
    if (existing) {
      const waiters = this.inFlightWaiters.get(key) ?? 0;
      if (waiters < this.config.load.maxWaiters) {
        this.inFlightWaiters.set(key, waiters + 1);
        return existing
          .finally(() => {
            const remaining = (this.inFlightWaiters.get(key) ?? 1) - 1;
            if (remaining <= 0) this.inFlightWaiters.delete(key);
            else this.inFlightWaiters.set(key, remaining);
          })
          .then((value) => value as T);
      }
      // Demasiados waiters: fallback controlado con duplicación acotada.
      return loadVersion.then((version) =>
        this.runLoaderWithSlot(
          key,
          loader,
          policy,
          cacheResult,
          writeLock,
          version,
        ),
      );
    }

    const promise = loadVersion.then((version) =>
      this.runLoaderWithSlot(
        key,
        loader,
        policy,
        cacheResult,
        writeLock,
        version,
      ),
    );
    this.inFlight.set(key, promise);
    return promise.finally(() => {
      this.inFlight.delete(key);
    });
  }

  private runLoaderWithSlot<T>(
    key: string,
    loader: CacheLoader<T>,
    policy: CachePolicy,
    cacheResult: boolean,
    writeLock?: import("./interfaces/DistributedCacheAdapter.js").CacheLock,
    loadVersion?: number,
  ): Promise<T> {
    const task = async (): Promise<T> => {
      const value = await this.runWithTiming(loader);
      if (cacheResult) {
        try {
          await this.storeValue(key, value, policy, writeLock, loadVersion);
        } catch (error) {
          if (!this.isRedisFailure(error)) throw error;
          if (policy.onRedisError === "fail") throw error;
          if (policy.onRedisError === "stale-if-error") {
            await this.storeL1Only(key, value, policy, undefined, loadVersion);
          }
        }
      }
      return value;
    };
    let acquired = false;
    return this.acquireLoadSlot()
      .then(() => {
        acquired = true;
        return task();
      })
      .finally(() => {
        if (acquired) this.releaseLoadSlot();
      });
  }

  /**
   * @description Ejecuta una operación (cargador/refresco) midiendo su duración y
   * reportando fallos a métricas. Los errores se re-lanzan: las métricas nunca
   * alteran el flujo funcional.
   */
  private runWithTiming<T>(operation: () => Promise<T>): Promise<T> {
    const start = performance.now();
    const finish = (): void => {
      this.metrics.onLoaderDuration((performance.now() - start) / 1000);
    };
    try {
      return operation().then(
        (value) => {
          finish();
          return value;
        },
        (error: unknown) => {
          finish();
          this.metrics.onLoaderError();
          throw error;
        },
      );
    } catch (error) {
      finish();
      this.metrics.onLoaderError();
      throw error;
    }
  }

  private acquireLoadSlot(): Promise<void> {
    if (this.activeLoads < this.config.load.maxConcurrent) {
      this.activeLoads++;
      return Promise.resolve();
    }
    if (this.loadQueue.length >= this.config.load.maxQueuedLoads) {
      this.metrics.onLoadShed?.();
      return Promise.reject(new CacheLoadShedError());
    }
    return new Promise((resolve) => {
      this.loadQueue.push(() => {
        this.activeLoads++;
        resolve();
      });
    });
  }

  private releaseLoadSlot(): void {
    this.activeLoads--;
    while (
      this.activeLoads < this.config.load.maxConcurrent &&
      this.loadQueue.length > 0
    ) {
      const next = this.loadQueue.shift()!;
      next();
    }
  }

  private async storeValue<T>(
    key: string,
    value: T,
    policy: CachePolicy,
    writeLock?: import("./interfaces/DistributedCacheAdapter.js").CacheLock,
    expectedVersion?: number,
  ): Promise<void> {
    const namespace = extractCacheNamespace(key);
    const version = await this.currentVersion(namespace);
    if (expectedVersion !== undefined && version !== expectedVersion) return;
    const isNegative = value === null || value === undefined;

    if (this.l2 && (policy.mode === "l2-only" || policy.mode === "multi")) {
      const l2Envelope = createCacheEnvelope<unknown>({
        value: isNegative ? null : value,
        namespaceVersion: version,
        freshTtlMs: isNegative ? this.config.l2.negativeTtlMs : policy.l2TtlMs,
        staleTtlMs: isNegative ? null : policy.staleTtlMs,
        isNegative,
      });
      if (!writeLock) return;
      const persisted = await this.redisCall("set", () =>
        this.l2!.setWhileHoldingLock(key, l2Envelope, writeLock),
      );
      if (!persisted) return;
      await this.populateL1(key, l2Envelope, policy);
      return;
    }

    await this.storeL1Only(key, value, policy, version);
  }

  private async storeL1Only<T>(
    key: string,
    value: T,
    policy: CachePolicy,
    version?: number,
    expectedVersion?: number,
  ): Promise<void> {
    if (value === null || value === undefined || !this.l1) return;
    const currentVersion = await this.l1.getVersion(extractCacheNamespace(key));
    if (expectedVersion !== undefined && currentVersion !== expectedVersion) {
      return;
    }
    await this.l1.set(
      key,
      createCacheEnvelope({
        value,
        namespaceVersion: version ?? currentVersion,
        freshTtlMs: policy.l1TtlMs,
      }),
    );
  }

  private async populateL1<T>(
    key: string,
    source: CacheEnvelope<T>,
    policy: CachePolicy,
  ): Promise<void> {
    if (!this.l1 || policy.mode === "l2-only") return;
    const now = Date.now();
    const namespace = extractCacheNamespace(key);
    const currentVersion = await this.l1.getVersion(namespace);
    if (source.namespaceVersion < currentVersion) return;
    const localFreshUntil = source.isNegative
      ? source.freshUntil === null
        ? now + this.config.l2.negativeTtlMs
        : Math.min(source.freshUntil, now + this.config.l2.negativeTtlMs)
      : source.freshUntil === null
        ? now + policy.l1TtlMs
        : Math.min(source.freshUntil, now + policy.l1TtlMs);
    await this.l1.set(key, {
      ...source,
      storedAt: now,
      freshUntil: localFreshUntil,
      staleUntil: source.staleUntil,
    });
  }

  private refreshInBackground<T>(
    key: string,
    loader: CacheLoader<T>,
    policy: CachePolicy,
  ): void {
    if (this.lifecycleState === "closing" || this.lifecycleState === "closed") {
      return;
    }
    if (this.refreshes.has(key)) return;
    this.refreshes.add(key);
    const refresh = this.trackOperation(() =>
      this.refreshAsync(key, loader, policy),
    );
    void refresh.catch(() => {}).finally(() => this.refreshes.delete(key));
  }

  private trackOperation<T>(operation: () => Promise<T>): Promise<T> {
    if (this.lifecycleState === "closing" || this.lifecycleState === "closed") {
      return Promise.reject(
        new Error("[FastifyKit Cache] La caché está cerrándose."),
      );
    }

    let tracked!: Promise<T>;
    tracked = Promise.resolve()
      .then(operation)
      .finally(() => this.activeOperations.delete(tracked));
    this.activeOperations.add(tracked);
    return tracked;
  }

  private async refreshAsync<T>(
    key: string,
    loader: CacheLoader<T>,
    policy: CachePolicy,
  ): Promise<void> {
    try {
      if (this.l2 && (policy.mode === "l2-only" || policy.mode === "multi")) {
        const lockKey = key;
        const lock = await this.redisCall("acquire_lock", () =>
          this.l2!.tryAcquireLock(lockKey, this.config.l2.lockTtlMs),
        );
        if (!lock) return; // otra instancia ya está refrescando

        try {
          await this.executeLoader(key, loader, policy, true, lock);
        } finally {
          await this.redisCall("release_lock", () =>
            this.l2!.releaseLock(lock),
          ).catch((error) => {
            this.logger.warn(
              `[FastifyKit Cache] Error liberando el lock de refresh (keyHash=${hashCacheKey(key)}): ${
                (error as Error).message
              }`,
            );
          });
        }
        return;
      }

      await this.executeLoader(key, loader, policy);
    } catch (error) {
      this.logger.warn(
        `[FastifyKit Cache] Error refrescando (keyHash=${hashCacheKey(key)}) en segundo plano: ${
          (error as Error).message
        }`,
      );
    }
  }

  private async handleInvalidation(
    message: CacheInvalidationMessage,
  ): Promise<void> {
    this.metrics.onInvalidationReceived();
    if (!this.l1) return;

    if (message.namespace === "*") {
      if (this.l1.clearEntries) await this.l1.clearEntries();
      else await this.l1.clearAll();
      await this.l1.setVersion("*", message.namespaceVersion);
      return;
    }

    if (message.keys !== undefined && message.keys.length > 0) {
      for (const key of message.keys) {
        await this.l1.delete(key);
      }
    } else {
      await this.l1.clearNamespace(message.namespace);
    }
    await this.l1.setVersion(message.namespace, message.namespaceVersion);
  }

  /**
   * @description Indica si un envelope es un dato FRESH servible (no negativo,
   * no expirado y dentro de su ventana fresca). El path de carga nunca sirve
   * stale: un envelope stale sin allowStale debe recargarse.
   */
  private isServableFresh<T>(
    envelope: CacheEnvelope<T> | null,
  ): envelope is CacheEnvelope<T> {
    return (
      envelope !== null &&
      !envelope.isNegative &&
      !isEnvelopeExpired(envelope) &&
      getEnvelopeFreshness(envelope) === "fresh"
    );
  }

  private isServable<T>(
    envelope: CacheEnvelope<T> | null,
  ): envelope is CacheEnvelope<T> {
    return (
      envelope !== null &&
      !isEnvelopeExpired(envelope) &&
      (envelope.isNegative || getEnvelopeFreshness(envelope) === "fresh")
    );
  }

  private async currentVersion(namespace: string): Promise<number> {
    const policy = this.resolvePolicy(namespace);
    if (this.l2 && policy.mode !== "l1-only") {
      return this.redisCall("get_version", () =>
        this.l2!.getVersion(namespace),
      );
    }
    return this.l1?.getVersion(namespace) ?? 0;
  }

  private async captureLoadVersion(
    key: string,
    policy: CachePolicy,
    authoritative: boolean,
  ): Promise<number | undefined> {
    const namespace = extractCacheNamespace(key);
    if (authoritative && this.l2 && policy.mode !== "l1-only") {
      return this.redisCall("get_version", () =>
        this.l2!.getVersion(namespace),
      );
    }
    return this.l1?.getVersion(namespace);
  }

  private async clearL1OnRecovery(): Promise<void> {
    if (!this.l1) return;
    if (this.l1.clearEntries) await this.l1.clearEntries();
    else await this.l1.clearAll();
  }

  private async acquireMutationLock(key: string): Promise<CacheLock> {
    if (!this.l2) throw new CacheDependencyUnavailableError("acquire_lock");
    const deadline = Date.now() + this.config.l2.mutationWaitMs;
    do {
      const lock = await this.redisCall("acquire_lock", () =>
        this.l2!.tryAcquireLock(key, this.config.l2.lockTtlMs),
      );
      if (lock) return lock;
      this.metrics.onLockContention();
      if (Date.now() >= deadline) break;
      await this.sleep(Math.min(25, Math.max(1, deadline - Date.now())));
    } while (Date.now() < deadline);
    throw new CacheMutationUnavailableError();
  }

  private async releaseMutationLock(lock: CacheLock): Promise<void> {
    try {
      await this.redisCall("release_lock", () => this.l2!.releaseLock(lock));
    } catch (error) {
      this.logger.warn(
        `[FastifyKit Cache] No se pudo liberar un lock de mutación: ${(error as Error).message}`,
      );
    }
  }

  private async withMutation<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.mutations.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.mutations.set(key, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.mutations.get(key) === tail) this.mutations.delete(key);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private jitteredDelay(attempt: number): number {
    const base = this.config.load.retryDelayMs * 2 ** (attempt - 1);
    return Math.round(base * (0.5 + Math.random() * 0.5));
  }

  private validateVersionNamespace(namespace: string): void {
    if (namespace !== "*") validateCacheNamespace(namespace);
  }
}
