import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { InMemoryCacheAdapter } from "../../../src/cache/adapters/InMemoryCacheAdapter.js";
import { CacheService } from "../../../src/cache/CacheService.js";
import type { CacheEnvelope } from "../../../src/cache/interfaces/CacheAdapter.js";
import { buildResolvedCacheConfig } from "../../../src/cache/interfaces/CacheConfig.js";
import type { CacheMetrics } from "../../../src/cache/interfaces/CacheMetrics.js";
import { createCacheEnvelope } from "../../../src/cache/interfaces/CacheResult.js";
import type {
  CacheInvalidationMessage,
  CacheLock,
  DistributedCacheAdapter,
} from "../../../src/cache/interfaces/DistributedCacheAdapter.js";
import { CacheCodecError } from "../../../src/cache/redis/CacheEnvelopeCodec.js";
import type { DistributedCacheOptions } from "../../../src/core/interfaces/cache.interface.js";

function makeConfig(
  overrides?: Partial<DistributedCacheOptions> & {
    mode?: "l1-only" | "l2-only" | "multi";
  },
) {
  return buildResolvedCacheConfig({
    mode: "multi",
    l2: { defaultTtlSeconds: 60, staleTtlSeconds: 600, negativeTtlSeconds: 5 },
    load: {
      maxConcurrent: 4,
      maxWaiters: 2,
      retryAttempts: 2,
      retryDelayMs: 5,
    },
    ...overrides,
  });
}

interface MockL2 {
  store: Map<string, CacheEnvelope>;
  versionStore: Map<string, number>;
  locks: Map<string, string>;
  published: CacheInvalidationMessage[];
  handlers: Array<(message: CacheInvalidationMessage) => void>;
  adapter: DistributedCacheAdapter;
}

function makeMockL2(): MockL2 {
  const store = new Map<string, CacheEnvelope>();
  const versionStore = new Map<string, number>();
  const locks = new Map<string, string>();
  const published: CacheInvalidationMessage[] = [];
  const handlers: Array<(message: CacheInvalidationMessage) => void> = [];

  const adapter = {
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: vi.fn((key: string, envelope: CacheEnvelope) => {
      store.set(key, envelope);
      return Promise.resolve();
    }),
    delete: vi.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    clearNamespace: vi.fn((namespace: string) => {
      for (const key of [...store.keys()]) {
        if (key.startsWith(`${namespace}:`)) store.delete(key);
      }
      versionStore.set(namespace, (versionStore.get(namespace) ?? 0) + 1);
      return Promise.resolve();
    }),
    clearAll: vi.fn(() => {
      store.clear();
      versionStore.clear();
      return Promise.resolve();
    }),
    getVersion: vi.fn((namespace: string) =>
      Promise.resolve(versionStore.get(namespace) ?? 0),
    ),
    setVersion: vi.fn((namespace: string, version: number) => {
      versionStore.set(namespace, version);
      return Promise.resolve();
    }),
    tryAcquireLock: vi.fn((key: string, ttlMs: number) => {
      if (locks.has(key)) return Promise.resolve(null);
      locks.set(key, "token");
      const lock: CacheLock = {
        key,
        token: "token",
        expiresAt: Date.now() + ttlMs,
      };
      return Promise.resolve(lock);
    }),
    releaseLock: vi.fn((lock: CacheLock) => {
      locks.delete(lock.key);
      return Promise.resolve();
    }),
    setWhileHoldingLock: vi.fn(
      (key: string, envelope: CacheEnvelope, lock: CacheLock) => {
        if (locks.get(lock.key) !== lock.token) return Promise.resolve(false);
        store.set(key, envelope);
        return Promise.resolve(true);
      },
    ),
    deleteWhileHoldingLock: vi.fn((key: string, lock: CacheLock) => {
      if (locks.get(lock.key) !== lock.token) return Promise.resolve(false);
      store.delete(key);
      return Promise.resolve(true);
    }),
    publishInvalidation: vi.fn((message: CacheInvalidationMessage) => {
      published.push(message);
      return Promise.resolve();
    }),
    subscribeInvalidation: vi.fn(
      (handler: (m: CacheInvalidationMessage) => void) => {
        handlers.push(handler);
        return Promise.resolve(() => {
          handlers.length = 0;
          return Promise.resolve();
        });
      },
    ),
    close: vi.fn(() => Promise.resolve()),
  } as unknown as DistributedCacheAdapter;

  return { store, versionStore, locks, published, handlers, adapter };
}

function makeL1() {
  return new InMemoryCacheAdapter({ maxSize: 100 });
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeFreshEnvelope(value: unknown, ttlMs = 60_000): CacheEnvelope {
  return createCacheEnvelope({
    value,
    namespaceVersion: 0,
    freshTtlMs: ttlMs,
    staleTtlMs: ttlMs * 10,
  });
}

describe("CacheService (orquestador multi-capa)", () => {
  let l1: InMemoryCacheAdapter;
  let mock: MockL2;
  let service: CacheService;

  beforeEach(() => {
    l1 = makeL1();
    mock = makeMockL2();
    service = new CacheService({ l1, l2: mock.adapter, config: makeConfig() });
  });

  afterEach(async () => {
    await service.close();
    vi.restoreAllMocks();
  });

  it("Debería responder desde L1 fresh sin ejecutar el loader", async () => {
    await l1.set("users:1", makeFreshEnvelope({ id: 1 }));
    const loader = vi.fn(() => Promise.resolve({ id: 2 }));

    const result = await service.getOrLoad("users:1", loader);

    expect(result).toEqual({ id: 1 });
    expect(loader).not.toHaveBeenCalled();
  });

  it("no repuebla un loader iniciado antes de invalidar su namespace", async () => {
    let release!: () => void;
    const releaseLoader = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const loaderStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const promise = service.getOrLoad("users:1", async () => {
      started();
      await releaseLoader;
      return "loaded-before-clear";
    });

    await loaderStarted;
    await service.clearNamespace("users");
    release();

    expect(await promise).toBe("loaded-before-clear");
    expect(mock.store.has("users:1")).toBe(false);
    expect(await l1.get("users:1")).toBeNull();
  });

  it("rechaza TTLs por llamada no finitos antes de ejecutar el loader", async () => {
    const loader = vi.fn(() => Promise.resolve("value"));

    await expect(
      service.getOrLoad("users:ttl", loader, { ttlSeconds: Infinity }),
    ).rejects.toThrow("ttlSeconds");
    expect(loader).not.toHaveBeenCalled();
  });

  it("propaga errores de codec sin clasificarlos como outage Redis", async () => {
    const codecError = new CacheCodecError("invalid payload");
    mock.adapter.setWhileHoldingLock = vi.fn(() => Promise.reject(codecError));

    await expect(
      service.getOrLoad("users:codec", () => Promise.resolve("value")),
    ).rejects.toBe(codecError);
  });

  it("debería permitir reintentar start después de un fallo de suscripción", async () => {
    let attempts = 0;
    const subscribeInvalidation = vi.fn(() => {
      attempts++;
      if (attempts === 1) {
        return Promise.reject(new Error("subscriber unavailable"));
      }
      return Promise.resolve(() => Promise.resolve());
    });
    const retryableL2 = {
      ...mock.adapter,
      subscribeInvalidation,
    } as DistributedCacheAdapter;
    const retryable = new CacheService({
      l1,
      l2: retryableL2,
      config: makeConfig(),
    });

    await expect(retryable.start()).rejects.toThrow("subscriber unavailable");
    await expect(retryable.start()).resolves.toBeUndefined();
    expect(subscribeInvalidation).toHaveBeenCalledTimes(2);
    await retryable.close();
  });

  it("debería drenar loaders activos y hacer close idempotente", async () => {
    let releaseLoader!: () => void;
    const loaderReleased = new Promise<void>((resolve) => {
      releaseLoader = resolve;
    });
    const loader = service.getOrLoad("users:draining", async () => {
      await loaderReleased;
      return "done";
    });
    await flush();

    let closed = false;
    const closePromise = service.close().then(() => {
      closed = true;
    });
    await flush();
    expect(closed).toBe(false);

    releaseLoader();
    await expect(loader).resolves.toBe("done");
    await Promise.all([closePromise, service.close(), service.close()]);
    expect((mock.adapter.close as any).mock.calls).toHaveLength(1);
    await expect(
      service.getOrLoad("users:after-close", () => Promise.resolve("nope")),
    ).rejects.toThrow("cerrándose");
  });

  it("Debería poblar L1 desde L2 fresh sin ejecutar el loader", async () => {
    mock.store.set("users:1", makeFreshEnvelope({ id: 1 }));
    const loader = vi.fn(() => Promise.resolve({ id: 2 }));

    const result = await service.getOrLoad("users:1", loader);

    expect(result).toEqual({ id: 1 });
    expect(loader).not.toHaveBeenCalled();
    expect(await l1.get("users:1")).not.toBeNull();
  });

  it("Debería ejecutar el loader en miss y almacenar en L2 y L1", async () => {
    const loader = vi.fn(() => Promise.resolve("fresh-value"));

    const result = await service.getOrLoad("users:1", loader);

    expect(result).toBe("fresh-value");
    expect(loader).toHaveBeenCalledTimes(1);
    expect(mock.store.get("users:1")?.value).toBe("fresh-value");
    expect((await l1.get("users:1"))?.value).toBe("fresh-value");
  });

  it("Debería normalizar el TTL stale cuando un override fresh es mayor", async () => {
    const result = await service.getOrLoad(
      "users:ttl-override",
      () => Promise.resolve("value"),
      { ttlSeconds: 1_200 },
    );

    const envelope = mock.store.get("users:ttl-override");
    expect(result).toBe("value");
    expect(envelope).toBeDefined();
    expect(envelope!.staleUntil).toBeGreaterThanOrEqual(envelope!.freshUntil!);
  });

  it("Debería servir stale y refrescar en segundo plano cuando allowStale", async () => {
    const staleEnvelope = createCacheEnvelope({
      value: "stale-value",
      namespaceVersion: 0,
      storedAt: Date.now() - 60_000,
      freshTtlMs: 10_000,
      staleTtlMs: 600_000,
    });
    mock.store.set("users:1", staleEnvelope);
    const loader = vi.fn(() => Promise.resolve("fresh-value"));

    const result = await service.getOrLoad("users:1", loader);
    expect(result).toBe("stale-value");

    await flush();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(mock.store.get("users:1")?.value).toBe("fresh-value");
  });

  it("Debería recargar en lugar de servir stale cuando allowStale es falso", async () => {
    const staleEnvelope = createCacheEnvelope({
      value: "stale-value",
      namespaceVersion: 0,
      storedAt: Date.now() - 60_000,
      freshTtlMs: 10_000,
      staleTtlMs: 600_000,
    });
    mock.store.set("users:1", staleEnvelope);
    const loader = vi.fn(() => Promise.resolve("fresh-value"));

    const result = await service.getOrLoad("users:1", loader, {
      allowStale: false,
    });

    expect(result).toBe("fresh-value");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("Debería servir el dato que aparece durante el retry cuando el lock está ocupado", async () => {
    mock.locks.set("users:1", "other-token");
    const loader = vi.fn(() => Promise.resolve("loaded"));
    mock.adapter.get = vi
      .fn()
      .mockReturnValueOnce(Promise.resolve(null)) // readThrough
      .mockReturnValueOnce(Promise.resolve(null)) // retry 1
      .mockReturnValueOnce(Promise.resolve(makeFreshEnvelope("arrived"))); // retry 2

    const result = await service.getOrLoad("users:1", loader);

    expect(result).toBe("arrived");
    expect(loader).not.toHaveBeenCalled();
  });

  it("Debería cargar localmente como fallback cuando el lock sigue ocupado sin dato", async () => {
    mock.locks.set("users:1", "other-token");
    const loader = vi.fn(() => Promise.resolve("fallback-value"));
    mock.adapter.get = vi.fn(() => Promise.resolve(null));

    const result = await service.getOrLoad("users:1", loader);

    expect(result).toBe("fallback-value");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("Debería hacer double-check tras adquirir el lock (evitar carga duplicada)", async () => {
    const loader = vi.fn(() => Promise.resolve("loaded"));
    mock.adapter.get = vi
      .fn()
      .mockReturnValueOnce(Promise.resolve(null)) // readThrough
      .mockReturnValueOnce(
        Promise.resolve(makeFreshEnvelope("already-loaded")),
      ); // double-check

    const result = await service.getOrLoad("users:1", loader);

    expect(result).toBe("already-loaded");
    expect(loader).not.toHaveBeenCalled();
  });

  it("Debería respetar una entrada negativa encontrada durante el double-check", async () => {
    const negative = createCacheEnvelope({
      value: null,
      namespaceVersion: 0,
      freshTtlMs: 5_000,
      staleTtlMs: null,
      isNegative: true,
    });
    mock.adapter.get = vi
      .fn()
      .mockResolvedValueOnce(null) // readThrough
      .mockResolvedValueOnce(negative); // double-check
    const loader = vi.fn(() => Promise.resolve("should-not-load"));

    await expect(service.getOrLoad("users:negative", loader)).resolves.toBe(
      null,
    );
    expect(loader).not.toHaveBeenCalled();
  });

  it("Debería cachear negativamente los valores null/undefined del loader (con L2)", async () => {
    const loader = vi.fn(() => Promise.resolve(null));

    expect(await service.getOrLoad("users:1", loader)).toBeNull();
    expect(await service.getOrLoad("users:1", loader)).toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(mock.store.get("users:1")?.isNegative).toBe(true);
  });

  it("no debería extender el TTL negativo al repoblar L1 desde L2", async () => {
    const negative = createCacheEnvelope({
      value: null,
      namespaceVersion: 0,
      storedAt: Date.now() - 4_000,
      freshTtlMs: 5_000,
      staleTtlMs: null,
      isNegative: true,
    });
    mock.store.set("users:negative", negative);

    await expect(
      service.getOrLoad("users:negative", () => Promise.resolve("loaded")),
    ).resolves.toBeNull();

    const local = await l1.get("users:negative");
    expect(local?.freshUntil).toBeLessThanOrEqual(negative.freshUntil!);
  });

  it("Debería NO cachear negativamente en modo l1-only", async () => {
    const localService = new CacheService({
      l1,
      config: makeConfig({ mode: "l1-only" }),
    });
    const loader = vi.fn(() => Promise.resolve(null));

    expect(await localService.getOrLoad("users:1", loader)).toBeNull();
    expect(await localService.getOrLoad("users:1", loader)).toBeNull();
    expect(loader).toHaveBeenCalledTimes(2);
    await localService.close();
  });

  it("Debería limitar los loaders simultáneos con maxConcurrent", async () => {
    const localService = new CacheService({
      l1,
      l2: mock.adapter,
      config: makeConfig({ load: { maxConcurrent: 1 } }),
    });

    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const loader1 = vi.fn(async () => {
      await firstGate;
      return "first";
    });
    const loader2 = vi.fn(() => Promise.resolve("second"));

    const promise1 = localService.getOrLoad("k1", loader1);
    await flush();
    const promise2 = localService.getOrLoad("k2", loader2);
    await flush();

    expect(loader2).not.toHaveBeenCalled(); // espera slot

    releaseFirst();
    await promise1;
    expect(await promise2).toBe("second");
    await localService.close();
  });

  it("Debería liberar correctamente el semáforo después de varias cargas en cola", async () => {
    const localService = new CacheService({
      l1,
      l2: mock.adapter,
      config: makeConfig({ load: { maxConcurrent: 1, maxQueuedLoads: 3 } }),
    });
    let active = 0;
    let maximumActive = 0;
    const loaders = [1, 2, 3, 4].map((index) =>
      vi.fn(async () => {
        active++;
        maximumActive = Math.max(maximumActive, active);
        await Promise.resolve();
        active--;
        return `value-${index}`;
      }),
    );

    const results = await Promise.all(
      loaders.map((loader, index) =>
        localService.getOrLoad(`queued:${index}`, loader),
      ),
    );

    expect(results).toEqual(["value-1", "value-2", "value-3", "value-4"]);
    expect(maximumActive).toBe(1);
    expect(loaders.map((loader) => loader.mock.calls.length)).toEqual([
      1, 1, 1, 1,
    ]);
    await localService.close();
  });

  it("Debería aplicar bypass-l1 si Redis falla al adquirir el lock", async () => {
    const localService = new CacheService({
      l1,
      l2: mock.adapter,
      config: makeConfig({
        l2: { failureThreshold: 10 },
        onRedisError: "bypass-l1",
      }),
    });
    mock.adapter.tryAcquireLock = vi.fn(() =>
      Promise.reject(new Error("redis-down")),
    );
    const loader = vi.fn(() => Promise.resolve("source-value"));

    await expect(localService.getOrLoad("locks:1", loader)).resolves.toBe(
      "source-value",
    );
    expect(loader).toHaveBeenCalledTimes(1);
    expect(await l1.get("locks:1")).toBeNull();
    await localService.close();
  });

  it("Debería aplicar stale-if-error si Redis falla durante un retry", async () => {
    const localService = new CacheService({
      l1,
      l2: mock.adapter,
      config: makeConfig({
        l2: { failureThreshold: 10 },
        namespaces: {
          retry: { onRedisError: "stale-if-error", allowStale: true },
        },
      }),
    });
    await l1.set(
      "retry:1",
      createCacheEnvelope({
        value: "stale-value",
        namespaceVersion: 0,
        storedAt: Date.now() - 60_000,
        freshTtlMs: 1_000,
        staleTtlMs: 120_000,
      }),
    );
    mock.locks.set("retry:1", "other-token");
    mock.adapter.get = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("redis-down"));

    const loader = vi.fn(() => Promise.resolve("new-value"));
    await expect(localService.getOrLoad("retry:1", loader)).resolves.toBe(
      "stale-value",
    );
    expect(loader).not.toHaveBeenCalled();
    await localService.close();
  });

  it("Debería aplicar maxWaiters: los waiters excedentes ejecutan fallback con duplicación", async () => {
    const localService = new CacheService({
      l1,
      l2: mock.adapter,
      config: makeConfig({
        load: {
          maxConcurrent: 4,
          maxWaiters: 1,
          retryAttempts: 2,
          retryDelayMs: 5,
        },
      }),
    });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loader = vi.fn(async () => {
      await gate;
      return "value";
    });

    const p1 = localService.getOrLoad("users:1", loader);
    await new Promise((resolve) => setTimeout(resolve, 40)); // p1 adquiere lock e in-flight
    const p2 = localService.getOrLoad("users:1", loader); // espera el in-flight (waiter 1)
    const p3 = localService.getOrLoad("users:1", loader); // excede maxWaiters → fallback

    await new Promise((resolve) => setTimeout(resolve, 60)); // cubre los retries del lock
    expect(loader).toHaveBeenCalledTimes(2); // 1 in-flight + 1 fallback

    release();
    const results = await Promise.all([p1, p2, p3]);
    expect(results).toEqual(["value", "value", "value"]);
    await localService.close();
  });

  it("Debería propagar los errores del loader y no almacenarlos", async () => {
    const loader = vi.fn(() => Promise.reject(new Error("boom")));

    await expect(service.getOrLoad("users:1", loader)).rejects.toThrow("boom");
    expect(mock.store.has("users:1")).toBe(false);
  });

  it("Debería refrescar en segundo plano sin romper la respuesta cuando el loader falla", async () => {
    const staleEnvelope = createCacheEnvelope({
      value: "stale-value",
      namespaceVersion: 0,
      storedAt: Date.now() - 60_000,
      freshTtlMs: 10_000,
      staleTtlMs: 600_000,
    });
    mock.store.set("users:1", staleEnvelope);
    const loader = vi.fn(() => Promise.reject(new Error("refresh failed")));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await service.getOrLoad("users:1", loader);
    expect(result).toBe("stale-value");

    await flush();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("Debería eliminar la clave en ambas capas", async () => {
    await l1.set("users:1", makeFreshEnvelope("a"));
    mock.store.set("users:1", makeFreshEnvelope("a"));

    await service.delete("users:1");

    expect(await l1.get("users:1")).toBeNull();
    expect(mock.store.has("users:1")).toBe(false);
  });

  it("Debería limpiar el namespace en ambas capas", async () => {
    await l1.set("users:1", makeFreshEnvelope("a"));
    await l1.set("users:2", makeFreshEnvelope("b"));
    mock.store.set("users:1", makeFreshEnvelope("a"));

    await service.clearNamespace("users");

    expect(await l1.get("users:1")).toBeNull();
    expect(await l1.get("users:2")).toBeNull();
    expect(mock.store.has("users:1")).toBe(false);
  });

  it("Debería mantener las operaciones de namespace L1-only fuera de Redis", async () => {
    const localService = new CacheService({
      l1,
      l2: mock.adapter,
      config: makeConfig({
        namespaces: { local: { mode: "l1-only" } },
      }),
    });
    const clearNamespace = vi.fn(() => Promise.reject(new Error("redis-down")));
    const getVersion = vi.fn(() => Promise.reject(new Error("redis-down")));
    const setVersion = vi.fn(() => Promise.reject(new Error("redis-down")));
    mock.adapter.clearNamespace = clearNamespace;
    mock.adapter.getVersion = getVersion;
    mock.adapter.setVersion = setVersion;

    await localService.clearNamespace("local");
    await expect(localService.getVersion("local")).resolves.toBe(1);
    await expect(localService.setVersion("local", 3)).resolves.toBeUndefined();

    expect(clearNamespace).not.toHaveBeenCalled();
    expect(getVersion).not.toHaveBeenCalled();
    expect(setVersion).not.toHaveBeenCalled();
    await localService.close();
  });

  it("Debería publicar invalidación en un set explícito", async () => {
    await service.set("users:1", makeFreshEnvelope("v1"));

    expect(mock.published).toContainEqual({
      namespace: "users",
      namespaceVersion: 0,
      keys: ["users:1"],
    });
  });

  it("Debería NO publicar al cachear resultados del loader", async () => {
    await service.getOrLoad("users:1", () => Promise.resolve("value"));

    expect(mock.published).toHaveLength(0);
  });

  it("Debería cerrar la suscripción en beforeApplicationShutdown (lifecycle)", async () => {
    await service.start();
    expect(mock.handlers).toHaveLength(1);

    await service.beforeApplicationShutdown();

    expect(mock.handlers).toHaveLength(0);
  });

  it("Debería limpiar el L1 local al recibir invalidaciones con keys", async () => {
    await service.start();
    await l1.set("users:1", makeFreshEnvelope("stale-local"));

    mock.handlers[0]({
      namespace: "users",
      namespaceVersion: 3,
      keys: ["users:1"],
    });
    await flush();

    expect(await l1.get("users:1")).toBeNull();
    expect(await l1.getVersion("users")).toBe(3);
  });

  it("Debería limpiar el namespace L1 al recibir invalidaciones sin keys", async () => {
    await service.start();
    await l1.set("users:1", makeFreshEnvelope("a"));
    await l1.set("users:2", makeFreshEnvelope("b"));

    mock.handlers[0]({ namespace: "users", namespaceVersion: 5 });
    await flush();

    expect(await l1.get("users:1")).toBeNull();
    expect(await l1.get("users:2")).toBeNull();
    expect(await l1.getVersion("users")).toBe(5);
  });

  it("Debería respetar el modo l2-only por namespace (sin tocar L1)", async () => {
    const localService = new CacheService({
      l1,
      l2: mock.adapter,
      config: makeConfig({
        namespaces: { sessions: { mode: "l2-only" } },
      }),
    });
    const loader = vi.fn(() => Promise.resolve("session-data"));

    await localService.getOrLoad("sessions:abc", loader);

    expect(await l1.get("sessions:abc")).toBeNull();
    expect(mock.store.get("sessions:abc")?.value).toBe("session-data");
    await localService.close();
  });

  it("Debería soportar get() simple respetando el modo multi", async () => {
    mock.store.set("users:1", makeFreshEnvelope("from-l2"));

    const envelope = await service.get<"from-l2">("users:1");

    expect(envelope?.value).toBe("from-l2");
    expect(await l1.get("users:1")).not.toBeNull(); // populate
  });

  it("no debería repoblar L1 con una lectura L2 que quedó invalidada", async () => {
    let releaseRead!: (envelope: CacheEnvelope) => void;
    let readStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      readStarted = resolve;
    });
    const pendingRead = new Promise<CacheEnvelope>((resolve) => {
      releaseRead = resolve;
    });
    mock.adapter.get = vi.fn(async () => {
      readStarted();
      return pendingRead;
    }) as typeof mock.adapter.get;
    const l1Set = vi.spyOn(l1, "set");
    const read = service.get("users:race");

    await started;
    await service.clearNamespace("users");
    releaseRead(makeFreshEnvelope("stale-read"));
    await expect(read).resolves.toMatchObject({ value: "stale-read" });

    expect(l1Set).not.toHaveBeenCalled();
  });

  it("Debería limpiar todo con clearAll sin publicar", async () => {
    await l1.set("users:1", makeFreshEnvelope("a"));
    mock.store.set("users:1", makeFreshEnvelope("a"));

    await service.clearAll();

    expect(await l1.get("users:1")).toBeNull();
    expect(mock.store.size).toBe(0);
    expect(mock.published).toHaveLength(0);
  });

  it("Debería ser tolerante cuando el servicio no tiene L2 (l1-only)", async () => {
    const localService = new CacheService({
      l1,
      config: makeConfig({ mode: "l1-only" }),
    });
    const loader = vi.fn(() => Promise.resolve("local"));

    expect(await localService.getOrLoad("users:1", loader)).toBe("local");
    expect((await l1.get("users:1"))?.value).toBe("local");
    expect(mock.published).toHaveLength(0);
    await localService.close();
  });

  it("Debería hacer bypass de L1 y no escribir durante una caída Redis", async () => {
    const localService = new CacheService({
      l1,
      l2: mock.adapter,
      config: makeConfig({
        l2: { failureThreshold: 1 },
        onRedisError: "bypass-l1",
      }),
    });
    mock.adapter.get = vi.fn(() => Promise.reject(new Error("redis-down")));
    const loader = vi.fn(() => Promise.resolve("source-of-truth"));

    expect(await localService.getOrLoad("users:1", loader)).toBe(
      "source-of-truth",
    );
    expect(await l1.get("users:1")).toBeNull();
    expect(mock.store.has("users:1")).toBe(false);
    await localService.close();
  });

  it("Debería servir stale-if-error solo dentro de su deadline", async () => {
    const localService = new CacheService({
      l1,
      l2: mock.adapter,
      config: makeConfig({
        l2: { failureThreshold: 1 },
        namespaces: {
          catalog: { onRedisError: "stale-if-error", allowStale: true },
        },
      }),
    });
    await l1.set(
      "catalog:1",
      createCacheEnvelope({
        value: "old",
        namespaceVersion: 0,
        storedAt: Date.now() - 60_000,
        freshTtlMs: 1_000,
        staleTtlMs: 120_000,
      }),
    );
    mock.adapter.get = vi.fn(() => Promise.reject(new Error("redis-down")));

    expect(
      await localService.getOrLoad("catalog:1", () => Promise.resolve("new")),
    ).toBe("old");
    await localService.close();
  });

  it("Debería lanzar el error tipado con política fail", async () => {
    const localService = new CacheService({
      l1,
      l2: mock.adapter,
      config: makeConfig({
        l2: { failureThreshold: 1 },
        onRedisError: "fail",
      }),
    });
    mock.adapter.get = vi.fn(() => Promise.reject(new Error("redis-down")));

    await expect(
      localService.getOrLoad("users:1", () => Promise.resolve("never")),
    ).rejects.toMatchObject({
      code: "CACHE_DEPENDENCY_UNAVAILABLE",
      dependency: "redis",
    });
    await localService.close();
  });

  describe("Observabilidad (CacheMetrics)", () => {
    type MetricsMock = {
      onRead: ReturnType<typeof vi.fn>;
      onLoaderDuration: ReturnType<typeof vi.fn>;
      onLockContention: ReturnType<typeof vi.fn>;
      onLoaderError: ReturnType<typeof vi.fn>;
      onInvalidationReceived: ReturnType<typeof vi.fn>;
    };

    let metrics: MetricsMock;

    beforeEach(() => {
      metrics = {
        onRead: vi.fn(),
        onLoaderDuration: vi.fn(),
        onLockContention: vi.fn(),
        onLoaderError: vi.fn(),
        onInvalidationReceived: vi.fn(),
      };
      service = new CacheService({
        l1,
        l2: mock.adapter,
        config: makeConfig(),
        metrics: metrics as unknown as CacheMetrics,
      });
    });

    it("Debería reportar hits de L1 y L2 en lecturas", async () => {
      await l1.set("users:1", makeFreshEnvelope("a"));
      await service.getOrLoad("users:1", () => Promise.resolve("ignored"));
      expect(metrics.onRead).toHaveBeenCalledWith("l1_hit");

      mock.store.set("users:2", makeFreshEnvelope("b"));
      await service.getOrLoad("users:2", () => Promise.resolve("ignored"));
      expect(metrics.onRead).toHaveBeenCalledWith("l2_hit");
    });

    it("Debería reportar stale, negative y miss en lecturas", async () => {
      mock.store.set(
        "users:1",
        createCacheEnvelope({
          value: "stale",
          namespaceVersion: 0,
          storedAt: Date.now() - 60_000,
          freshTtlMs: 10_000,
          staleTtlMs: 600_000,
        }),
      );
      await service.getOrLoad("users:1", () => Promise.resolve("x"));
      expect(metrics.onRead).toHaveBeenCalledWith("l2_stale");

      mock.store.set(
        "users:2",
        createCacheEnvelope({
          value: null,
          namespaceVersion: 0,
          freshTtlMs: 5_000,
          isNegative: true,
        }),
      );
      await service.getOrLoad("users:2", () => Promise.resolve(null));
      expect(metrics.onRead).toHaveBeenCalledWith("negative_hit");

      await service.getOrLoad("users:3", () => Promise.resolve("x"));
      expect(metrics.onRead).toHaveBeenCalledWith("miss");
      expect(metrics.onLoaderDuration).toHaveBeenCalledWith(expect.any(Number));
    });

    it("Debería reportar errores del loader sin romper la propagación", async () => {
      await expect(
        service.getOrLoad("users:1", () => Promise.reject(new Error("boom"))),
      ).rejects.toThrow("boom");

      expect(metrics.onLoaderError).toHaveBeenCalled();
      expect(metrics.onLoaderDuration).toHaveBeenCalledWith(expect.any(Number));
    });

    it("Debería reportar contienda de lock", async () => {
      mock.locks.set("users:1", "other-token");
      mock.adapter.get = vi.fn(() => Promise.resolve(null));

      await service.getOrLoad("users:1", () => Promise.resolve("x"));

      expect(metrics.onLockContention).toHaveBeenCalled();
    });

    it("Debería reportar invalidaciones recibidas", async () => {
      await service.start();
      mock.handlers[0]({ namespace: "users", namespaceVersion: 2 });
      await flush();

      expect(metrics.onInvalidationReceived).toHaveBeenCalled();
    });
  });
});
