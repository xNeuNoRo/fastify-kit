import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { Redis } from "ioredis";

import { getLogger } from "../../logger/logger.factory.js";
import { closeRedisConnection } from "../../distributed/redis.lifecycle.js";
import type {
  CacheAdapter,
  CacheEnvelope,
} from "../interfaces/CacheAdapter.js";
import type {
  CacheInvalidationMessage,
  CacheLock,
  DistributedCacheAdapter,
} from "../interfaces/DistributedCacheAdapter.js";
import {
  extractCacheNamespace,
  hashCacheKey,
  validateCacheNamespace,
} from "../namespace.js";
import { isEnvelopeExpired } from "../interfaces/CacheResult.js";
import {
  CacheCodecError,
  decodeCacheEnvelope,
  encodeCacheEnvelope,
} from "../redis/CacheEnvelopeCodec.js";
import { encodeInvalidationMessage } from "../redis/CacheInvalidationCodec.js";
import { CacheInvalidationSubscriber } from "../redis/CacheInvalidationSubscriber.js";

/**
 * @description Opciones de construcción del RedisCacheAdapter.
 */
export interface RedisCacheAdapterOptions {
  /**
   * Conexión compartida de Redis, prestada por RedisConnectionManager. El
   * adaptador la duplica para comandos y crea un suscriptor propio; solo cierra
   * esas conexiones derivadas, nunca la conexión base.
   */
  redis: Redis;
  /** Prefijo de todas las claves (aisla aplicaciones/entornos). */
  keyPrefix: string;
  /** Canal de Pub/Sub para las invalidaciones distribuidas. */
  invalidationChannel: string;
  /** Límite de espera para comandos de caché. */
  operationTimeoutMs?: number;
}

/**
 * Las URLs son seguras de construir durante el import; el contenido se lee solo
 * cuando una operación L2 necesita ejecutar el script. Esto mantiene el camino
 * l1-only libre de I/O de assets.
 */
const CACHE_LUA_SCRIPT_URLS = {
  releaseLock: new URL("../redis/scripts/release-lock.lua", import.meta.url),
  setWhileHoldingLock: new URL(
    "../redis/scripts/set-while-holding-lock.lua",
    import.meta.url,
  ),
  deleteWhileHoldingLock: new URL(
    "../redis/scripts/delete-while-holding-lock.lua",
    import.meta.url,
  ),
  deleteIfUnchanged: new URL(
    "../redis/scripts/delete-if-unchanged.lua",
    import.meta.url,
  ),
  setVersionMonotonically: new URL(
    "../redis/scripts/set-version-monotonically.lua",
    import.meta.url,
  ),
} as const;

type CacheLuaScriptName = keyof typeof CACHE_LUA_SCRIPT_URLS;

const cacheLuaScriptLoads = new Map<CacheLuaScriptName, Promise<string>>();

function loadCacheLuaScript(name: CacheLuaScriptName): Promise<string> {
  const cached = cacheLuaScriptLoads.get(name);
  if (cached) return cached;

  const loading = readFile(CACHE_LUA_SCRIPT_URLS[name], "utf8").catch(
    (error: unknown) => {
      throw new Error(
        `[FastifyKit Cache] No se pudo cargar el script Lua "${name}".`,
        { cause: error },
      );
    },
  );
  cacheLuaScriptLoads.set(name, loading);
  return loading;
}

const SCAN_BATCH_SIZE = 100;
const DELETE_BATCH_SIZE = 500;

/**
 * @description Adaptador L2 de caché: almacén distribuido sobre Redis.
 *
 * Estructura de claves (bajo `keyPrefix`):
 * - Entradas: `{prefix}entry:{key}` (ej: "fk:cache:entry:users:1")
 * - Versiones: `{prefix}meta:namespace-version:{namespace}` (INCR atómico)
 * - Locks: `{prefix}meta:lock:{key}` (SET NX PX + liberación Lua con token)
 *
 * Los metadatos viven en un subespacio físico separado de las entradas.
 *
 * Semántica:
 * - El TTL físico de Redis es la expiración total servible del envelope
 *   (`staleUntil ?? freshUntil`); las entradas permanentes no usan EX.
 * - Entradas corruptas (formato inválido) se eliminan y tratan como miss
 *   (autocuración con warning, no degradación silenciosa).
 * - `clearNamespace`/`delete` publican invalidación en el canal: cada instancia
 *   limpia su L1 local. El receptor NUNCA re-publica (usa APIs de L1), por lo
 *   que no hay bucles. La publicación es de mejor esfuerzo (at-most-once): un fallo de
 *   red se loguea y no rompe la operación local ya aplicada.
 * - `clearAll` limpia únicamente las claves de este prefijo, publica una
 *   invalidación global y nunca ejecuta FLUSHALL.
 * - Locks con expiración: un cargador que tarde más que el TTL del lock puede
 *   ejecutarse en paralelo en otra instancia (duplicación posible, nunca deadlock).
 *
 * Este adaptador NO ejecuta cargadores ni decide políticas: es un almacén distribuido.
 */
export class RedisCacheAdapter implements DistributedCacheAdapter {
  private readonly redis: Redis;
  private readonly ownsRedis: boolean;
  private readonly keyPrefix: string;
  private readonly invalidationChannel: string;
  private readonly operationTimeoutMs: number;
  private readonly subscriber: CacheInvalidationSubscriber;
  private readonly instanceId = randomUUID();
  private readonly logger = getLogger();
  private readiness?: Promise<void>;

  constructor(options: RedisCacheAdapterOptions) {
    this.redis = options.redis.duplicate({
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      commandTimeout: options.operationTimeoutMs ?? 500,
    });
    this.ownsRedis = this.redis !== options.redis;
    this.redis.on("error", (error) => {
      this.logger.error(
        `[FastifyKit Cache] Error en la conexión de comandos Redis: ${error.message}`,
      );
    });
    this.keyPrefix = options.keyPrefix;
    this.invalidationChannel = options.invalidationChannel;
    this.operationTimeoutMs = options.operationTimeoutMs ?? 500;
    this.subscriber = new CacheInvalidationSubscriber(
      options.invalidationChannel,
      this.instanceId,
    );
  }

  async get<T>(key: string): Promise<CacheEnvelope<T> | null> {
    await this.ensureReady();
    const redisKey = this.keyOf(key);
    const namespace = extractCacheNamespace(key);

    // MGET en un solo viaje de ida y vuelta: la entrada y la versión actual del namespace.
    // La validación de versión cierra la race de un write concurrente con una
    // invalidación (el escritor pudo leer la versión ANTES del bump y persistir
    // un envelope obsoleto que no debe servirse).
    const [raw, rawVersion, rawGlobalVersion] = await this.redis.mget(
      redisKey,
      this.versionKeyOf(namespace),
      this.globalVersionKey(),
    );
    if (raw === null) return null;

    let envelope: CacheEnvelope;
    try {
      envelope = decodeCacheEnvelope(raw);
    } catch (error) {
      this.logger.warn(
        `[FastifyKit Cache] Entrada corrupta en Redis (keyHash=${hashCacheKey(key)}): se elimina y se trata como miss. ${
          error instanceof CacheCodecError ? error.message : ""
        }`.trimEnd(),
      );
      await this.deleteIfUnchanged(redisKey, raw).catch(() => {});
      return null;
    }

    if (
      envelope.namespaceVersion <
      Math.max(
        RedisCacheAdapter.parseVersion(rawVersion),
        RedisCacheAdapter.parseVersion(rawGlobalVersion),
      )
    ) {
      this.logger.warn(
        `[FastifyKit Cache] Entrada obsoleta por versión (keyHash=${hashCacheKey(key)}): se elimina y se trata como miss.`,
      );
      await this.deleteIfUnchanged(redisKey, raw).catch(() => {});
      return null;
    }

    if (isEnvelopeExpired(envelope)) {
      await this.deleteIfUnchanged(redisKey, raw).catch(() => {});
      return null;
    }

    return envelope as CacheEnvelope<T>;
  }

  async set<T>(key: string, envelope: CacheEnvelope<T>): Promise<void> {
    await this.ensureReady();
    const ttlSeconds = this.computeTtlSeconds(envelope);
    if (ttlSeconds === 0) {
      // La entrada ya venció: no tiene sentido persistirla.
      return;
    }

    const raw = encodeCacheEnvelope(envelope);
    const redisKey = this.keyOf(key);

    if (ttlSeconds !== null) {
      await this.redis.set(redisKey, raw, "EX", ttlSeconds);
    } else {
      await this.redis.set(redisKey, raw);
    }
  }

  async setWhileHoldingLock<T>(
    key: string,
    envelope: CacheEnvelope<T>,
    lock: CacheLock,
  ): Promise<boolean> {
    await this.ensureReady();
    const ttlSeconds = this.computeTtlSeconds(envelope);
    if (ttlSeconds === 0) return false;

    const namespace = extractCacheNamespace(key);
    const result = await this.redis.eval(
      await loadCacheLuaScript("setWhileHoldingLock"),
      4,
      lock.key,
      this.entryKeyOf(key),
      this.versionKeyOf(namespace),
      this.globalVersionKey(),
      lock.token,
      encodeCacheEnvelope(envelope),
      String(ttlSeconds ?? 0),
      String(envelope.namespaceVersion),
    );
    return Number(result) === 1;
  }

  async delete(key: string): Promise<void> {
    await this.ensureReady();
    const redisKey = this.entryKeyOf(key);
    await this.redis.del(redisKey);

    const namespace = extractCacheNamespace(key);
    await this.publishInvalidation({
      namespace,
      namespaceVersion: await this.getVersion(namespace),
      keys: [key],
    });
  }

  async deleteWhileHoldingLock(key: string, lock: CacheLock): Promise<boolean> {
    await this.ensureReady();
    const result = await this.redis.eval(
      await loadCacheLuaScript("deleteWhileHoldingLock"),
      2,
      lock.key,
      this.entryKeyOf(key),
      lock.token,
    );
    return Number(result) === 1;
  }

  async clearNamespace(namespace: string): Promise<void> {
    await this.ensureReady();
    validateCacheNamespace(namespace);
    const exactKey = `${this.keyPrefix}entry:${namespace}`;
    await this.scanAndDelete(
      `${this.keyPrefix}entry:${namespace}*`,
      (key) => key === exactKey || key.startsWith(`${exactKey}:`),
    );
    const namespaceVersion = await this.bumpVersion(namespace);

    await this.publishInvalidation({ namespace, namespaceVersion });
  }

  async clearAll(): Promise<void> {
    await this.ensureReady();
    await this.scanAndDelete(`${this.keyPrefix}entry:*`);
    const globalVersion = await this.redis.incr(this.globalVersionKey());
    await this.publishInvalidation({
      namespace: "*",
      namespaceVersion: globalVersion,
    });
  }

  async getVersion(namespace: string): Promise<number> {
    await this.ensureReady();
    this.validateVersionNamespace(namespace);
    const [raw, global] = await this.redis.mget(
      this.versionKeyOf(namespace),
      this.globalVersionKey(),
    );
    return Math.max(
      RedisCacheAdapter.parseVersion(raw),
      RedisCacheAdapter.parseVersion(global),
    );
  }

  async setVersion(namespace: string, version: number): Promise<void> {
    await this.ensureReady();
    this.validateVersionNamespace(namespace);
    if (!Number.isSafeInteger(version) || version < 0) {
      throw new Error(
        "[FastifyKit Cache] La versión del namespace debe ser un entero seguro no negativo.",
      );
    }
    const key =
      namespace === "*"
        ? this.globalVersionKey()
        : this.versionKeyOf(namespace);
    await this.redis.eval(
      await loadCacheLuaScript("setVersionMonotonically"),
      1,
      key,
      String(version),
    );
  }

  async tryAcquireLock(key: string, ttlMs: number): Promise<CacheLock | null> {
    await this.ensureReady();
    const lockKey = this.lockKeyOf(key);
    const token = randomUUID();
    const result = await this.redis.set(lockKey, token, "PX", ttlMs, "NX");
    if (result !== "OK") return null;
    return { key: lockKey, token, expiresAt: Date.now() + ttlMs };
  }

  async releaseLock(lock: CacheLock): Promise<void> {
    await this.ensureReady();
    await this.redis.eval(
      await loadCacheLuaScript("releaseLock"),
      1,
      lock.key,
      lock.token,
    );
  }

  async publishInvalidation(message: CacheInvalidationMessage): Promise<void> {
    await this.ensureReady();
    try {
      await this.redis.publish(
        this.invalidationChannel,
        encodeInvalidationMessage({ ...message, sourceId: this.instanceId }),
      );
    } catch (error) {
      this.logger.error(
        `[FastifyKit Cache] Error publicando invalidación en Redis: ${
          (error as Error).message
        }`,
      );
    }
  }

  async subscribeInvalidation(
    handler: (message: CacheInvalidationMessage) => void | Promise<void>,
  ): Promise<() => Promise<void>> {
    try {
      await this.ensureReady();
    } catch {
      // El arranque de Redis es de mejor esfuerzo; el suscriptor se reconectará
      // en segundo plano y las operaciones aplicarán su política de fallo configurada.
    }
    await this.subscriber.start(this.redis, handler, async () => {
      const namespaceVersion = await this.getVersion("*");
      await handler({ namespace: "*", namespaceVersion });
    });
    return () => this.subscriber.stop();
  }

  async close(): Promise<void> {
    await this.subscriber.stop();
    if (this.ownsRedis) await closeRedisConnection(this.redis).catch(() => {});
  }

  private entryKeyOf(key: string): string {
    return `${this.keyPrefix}entry:${key}`;
  }

  private keyOf(key: string): string {
    return this.entryKeyOf(key);
  }

  /**
   * @description Parsea el valor de una version key (número entero).
   * Valores ausentes o corruptos se resuelven como `0`.
   */
  private static parseVersion(raw: string | null): number {
    if (raw === null || !/^\d+$/.test(raw)) return 0;
    const parsed = Number(raw);
    return Number.isSafeInteger(parsed) ? parsed : 0;
  }

  private versionKeyOf(namespace: string): string {
    return `${this.keyPrefix}meta:namespace-version:${namespace}`;
  }

  private globalVersionKey(): string {
    return `${this.keyPrefix}meta:global-version`;
  }

  private lockKeyOf(key: string): string {
    return `${this.keyPrefix}meta:lock:${key}`;
  }

  private async deleteIfUnchanged(
    redisKey: string,
    raw: string,
  ): Promise<void> {
    await this.redis.eval(
      await loadCacheLuaScript("deleteIfUnchanged"),
      1,
      redisKey,
      raw,
    );
  }

  private async ensureReady(): Promise<void> {
    const redis = this.redis as Redis & { status?: string };
    if (redis.status === undefined || redis.status === "ready") return;
    this.readiness ??= new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer);
        redis.removeListener("ready", onReady);
        redis.removeListener("error", onError);
        redis.removeListener("end", onEnd);
      };
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onEnd = () => {
        cleanup();
        reject(
          new Error("Redis cache connection ended before becoming ready."),
        );
      };

      if (redis.status === "ready") {
        resolve();
        return;
      }
      redis.once("ready", onReady);
      redis.once("error", onError);
      redis.once("end", onEnd);
      timer = setTimeout(() => {
        cleanup();
        reject(new Error("Redis cache connection is not ready."));
      }, this.operationTimeoutMs);
    });

    const readiness = this.readiness;
    try {
      await readiness;
    } finally {
      if (this.readiness === readiness) this.readiness = undefined;
    }
  }

  private async bumpVersion(namespace: string): Promise<number> {
    return this.redis.incr(this.versionKeyOf(namespace));
  }

  private validateVersionNamespace(namespace: string): void {
    if (namespace !== "*") validateCacheNamespace(namespace);
  }

  /**
   * @description Calcula el TTL físico (segundos) de un envelope.
   * @returns `null` para entradas permanentes (sin expiración), `0` para entradas
   * ya vencidas (no persistir) y un número positivo para el resto.
   */
  private computeTtlSeconds(envelope: CacheEnvelope): number | null {
    const expiresAt = envelope.staleUntil ?? envelope.freshUntil;
    if (expiresAt === null) return null;
    const ttl = Math.ceil((expiresAt - Date.now()) / 1000);
    return ttl > 0 ? ttl : 0;
  }

  private scanAndDelete(
    pattern: string,
    predicate: (key: string) => boolean = () => true,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let pending = Promise.resolve();
      const stream = this.redis.scanStream({
        match: pattern,
        count: SCAN_BATCH_SIZE,
      });
      stream.on("data", (batch: string[]) => {
        stream.pause();
        pending = pending
          .then(() =>
            this.deleteInBatches(batch.filter((key) => predicate(key))),
          )
          .then(() => {
            stream.resume();
          });
      });
      stream.on("end", () => pending.then(resolve, reject));
      stream.on("error", (error) => reject(error));
    });
  }

  private async deleteInBatches(keys: string[]): Promise<void> {
    for (let index = 0; index < keys.length; index += DELETE_BATCH_SIZE) {
      const batch = keys.slice(index, index + DELETE_BATCH_SIZE);
      if (batch.length > 0) {
        await this.redis.del(...batch);
      }
    }
  }
}
