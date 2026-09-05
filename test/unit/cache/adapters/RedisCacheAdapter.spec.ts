import { Readable } from "node:stream";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { RedisCacheAdapter } from "../../../../src/cache/adapters/RedisCacheAdapter.js";
import type { CacheEnvelope } from "../../../../src/cache/interfaces/CacheAdapter.js";
import { createCacheEnvelope } from "../../../../src/cache/interfaces/CacheResult.js";
import { encodeCacheEnvelope } from "../../../../src/cache/redis/CacheEnvelopeCodec.js";

const PREFIX = "fk:cache:";
const CHANNEL = "fk:cache:invalidate";

interface FakeHandlers {
  message?: (channel: string, message: string) => void;
  error?: (error: Error) => void;
  ready?: () => void;
}

function createFakeRedis() {
  const store = new Map<string, string>();
  const handlers: FakeHandlers = {};
  const hooks: {
    onIncr?: (key: string, value: number) => void;
  } = {};

  const scanStream = (options: { match: string; count: number }) => {
    const pattern = options.match.endsWith("*")
      ? options.match.slice(0, -1)
      : options.match;
    const matches = [...store.keys()].filter((key) => key.startsWith(pattern));
    const stream = new Readable({ read() {}, objectMode: true });
    if (matches.length > 0) stream.push(matches);
    stream.push(null);
    return stream;
  };

  const redis = {
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    mget: vi.fn((...keys: string[]) =>
      Promise.resolve(keys.map((key) => store.get(key) ?? null)),
    ),
    set: vi.fn((key: string, value: string, ...args: string[]) => {
      if (args.includes("NX") && store.has(key)) return Promise.resolve(null);
      store.set(key, value);
      return Promise.resolve("OK");
    }),
    del: vi.fn((...keys: string[]) => {
      let count = 0;
      for (const key of keys) {
        if (store.delete(key)) count++;
      }
      return Promise.resolve(count);
    }),
    incr: vi.fn((key: string) => {
      const next = Number.parseInt(store.get(key) ?? "0", 10) + 1;
      store.set(key, String(next));
      hooks.onIncr?.(key, next);
      return Promise.resolve(next);
    }),
    eval: vi.fn((script: string, keyCount: number, ...args: string[]) => {
      if (script.includes("local current = tonumber")) {
        const current = Number.parseInt(store.get(args[0]) ?? "0", 10) || 0;
        const requested = Number.parseInt(args[keyCount], 10);
        if (current < requested) store.set(args[0], args[keyCount]);
        return Promise.resolve(current < requested ? "OK" : 0);
      }
      if (script.includes("KEYS[1]) == ARGV[1]")) {
        if (store.get(args[0]) === args[keyCount]) {
          store.delete(args[0]);
          return Promise.resolve(1);
        }
        return Promise.resolve(0);
      }
      if (script.includes("KEYS[1]) ~= ARGV[1]")) {
        if (store.get(args[0]) !== args[keyCount]) return Promise.resolve(0);
        if (keyCount === 4) {
          store.set(args[1], args[keyCount + 1]);
          return Promise.resolve(1);
        }
        store.delete(args[1]);
        return Promise.resolve(1);
      }
      return Promise.resolve(1);
    }),
    publish: vi.fn((_channel: string, _message: string) => Promise.resolve(1)),
    scanStream: vi.fn(scanStream),
    on: vi.fn((event: string, callback: unknown) => {
      handlers[event as keyof FakeHandlers] = callback as never;
      return redis;
    }),
    duplicate: vi.fn(() => redis),
    subscribe: vi.fn(() => Promise.resolve(1)),
    unsubscribe: vi.fn(() => Promise.resolve(1)),
    quit: vi.fn(() => Promise.resolve("OK")),
  };

  return {
    redis,
    store,
    hooks,
    emitMessage: (channel: string, message: string) => {
      handlers.message?.(channel, message);
    },
    emitReady: () => handlers.ready?.(),
  };
}

function makeEnvelope(
  value: unknown,
  ttlMs = 60_000,
  overrides?: Partial<CacheEnvelope>,
): CacheEnvelope {
  return createCacheEnvelope({
    value,
    namespaceVersion: overrides?.namespaceVersion ?? 0,
    freshTtlMs: ttlMs,
    staleTtlMs: ttlMs * 10,
  });
}

describe("RedisCacheAdapter (L2)", () => {
  let fake: ReturnType<typeof createFakeRedis>;
  let adapter: RedisCacheAdapter;

  beforeEach(() => {
    fake = createFakeRedis();
    adapter = new RedisCacheAdapter({
      redis: fake.redis as never,
      keyPrefix: PREFIX,
      invalidationChannel: CHANNEL,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Debería almacenar con el prefijo y TTL físico de la expiración total", async () => {
    const envelope = makeEnvelope("data", 60_000);
    await adapter.set("users:1", envelope);

    expect(fake.redis.set).toHaveBeenCalledWith(
      "fk:cache:entry:users:1",
      expect.any(String),
      "EX",
      600,
    );
  });

  it("Debería almacenar entradas permanentes sin TTL", async () => {
    const envelope = createCacheEnvelope({
      value: "forever",
      namespaceVersion: 0,
      freshTtlMs: null,
    });
    await adapter.set("users:1", envelope);

    expect(fake.redis.set).toHaveBeenCalledWith(
      "fk:cache:entry:users:1",
      expect.any(String),
    );
  });

  it("Debería omitir entradas ya vencidas", async () => {
    const envelope = createCacheEnvelope({
      value: "old",
      namespaceVersion: 0,
      storedAt: Date.now() - 10_000,
      freshTtlMs: 1_000,
    });
    await adapter.set("users:1", envelope);

    expect(fake.redis.set).not.toHaveBeenCalled();
  });

  it("Debería recuperar envelopes almacenados", async () => {
    await adapter.set("users:1", makeEnvelope({ id: 1 }));

    const result = await adapter.get<{ id: number }>("users:1");
    expect(result?.value).toEqual({ id: 1 });
    expect(result?.namespaceVersion).toBe(0);
  });

  it("Debería devolver null para claves inexistentes", async () => {
    expect(await adapter.get("users:1")).toBeNull();
  });

  it("Debería eliminar entradas expiradas lógicamente aunque Redis aún las conserve", async () => {
    const envelope = createCacheEnvelope({
      value: "expired",
      namespaceVersion: 0,
      storedAt: Date.now() - 10_000,
      freshTtlMs: 1_000,
      staleTtlMs: 2_000,
    });
    fake.store.set("fk:cache:entry:users:1", JSON.stringify(envelope));

    expect(await adapter.get("users:1")).toBeNull();
    expect(fake.store.has("fk:cache:entry:users:1")).toBe(false);
  });

  it("Debería autocorregir entradas corruptas: eliminar y tratar como miss", async () => {
    fake.store.set("fk:cache:entry:users:1", "not-json{");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await adapter.get("users:1")).toBeNull();
    expect(fake.store.has("fk:cache:entry:users:1")).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("Debería rechazar envelopes obsoletos por versión (race write vs invalidación)", async () => {
    await adapter.set("users:1", makeEnvelope("old"));
    await adapter.setVersion("users", 2);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await adapter.get("users:1")).toBeNull();
    expect(fake.store.has("fk:cache:entry:users:1")).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("Debería eliminar y publicar invalidación con la clave afectada", async () => {
    await adapter.set("users:1", makeEnvelope("data"));

    await adapter.delete("users:1");

    expect(fake.store.has("fk:cache:entry:users:1")).toBe(false);
    const payload = JSON.parse(fake.redis.publish.mock.calls[0][1]) as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      namespace: "users",
      namespaceVersion: 0,
      keys: ["users:1"],
    });
    expect(typeof payload.sourceId).toBe("string");
  });

  it("Debería limpiar el namespace exacto, bumpar versión y publicar", async () => {
    await adapter.set("users:1", makeEnvelope("a"));
    await adapter.set("users:2", makeEnvelope("b"));
    await adapter.set("users_premium:1", makeEnvelope("c"));

    await adapter.clearNamespace("users");

    expect(fake.store.has("fk:cache:entry:users:1")).toBe(false);
    expect(fake.store.has("fk:cache:entry:users:2")).toBe(false);
    expect(fake.store.has("fk:cache:entry:users_premium:1")).toBe(true);
    expect(fake.store.get("fk:cache:meta:namespace-version:users")).toBe("1");
    const payload = JSON.parse(fake.redis.publish.mock.calls[0][1]) as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      namespace: "users",
      namespaceVersion: 1,
    });
    expect(typeof payload.sourceId).toBe("string");
  });

  it("Debería limpiar todas sus claves bajo el prefijo y publicar invalidación global", async () => {
    await adapter.set("users:1", makeEnvelope("a"));
    await adapter.set("config:theme", makeEnvelope("dark"));
    await adapter.clearNamespace("users");

    await adapter.clearAll();

    expect(fake.store.has("fk:cache:entry:users:1")).toBe(false);
    expect(fake.store.has("fk:cache:entry:config:theme")).toBe(false);
    expect(fake.store.has("fk:cache:meta:global-version")).toBe(true);
    expect(fake.redis.publish).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fake.redis.publish.mock.calls[1][1])).toMatchObject({
      namespace: "*",
      namespaceVersion: 1,
    });
  });

  it("Debería resolver versiones con default 0 y sanear valores corruptos", async () => {
    expect(await adapter.getVersion("users")).toBe(0);

    fake.store.set("fk:cache:meta:namespace-version:users", "7");
    expect(await adapter.getVersion("users")).toBe(7);

    fake.store.set("fk:cache:meta:namespace-version:users", "not-a-number");
    expect(await adapter.getVersion("users")).toBe(0);
  });

  it("Debería sincronizar versiones con setVersion", async () => {
    await adapter.setVersion("users", 9);
    await adapter.setVersion("users", 3);
    expect(await adapter.getVersion("users")).toBe(9);
    expect(fake.redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("local current"),
      1,
      "fk:cache:meta:namespace-version:users",
      "3",
    );
  });

  it("Debería conservar un write posterior al bump durante clearNamespace", async () => {
    fake.hooks.onIncr = (key, version) => {
      if (key !== "fk:cache:meta:namespace-version:users") return;
      fake.store.set(
        "fk:cache:entry:users:written-after-clear",
        encodeCacheEnvelope(
          makeEnvelope("new", 60_000, {
            namespaceVersion: version,
          }),
        ),
      );
    };

    await adapter.set("users:old", makeEnvelope("old"));
    await adapter.clearNamespace("users");

    expect(await adapter.get("users:written-after-clear")).toMatchObject({
      value: "new",
      namespaceVersion: 1,
    });
  });

  it("Debería conservar un write posterior al bump durante clearAll", async () => {
    fake.hooks.onIncr = (key, version) => {
      if (key !== "fk:cache:meta:global-version") return;
      fake.store.set(
        "fk:cache:entry:config:written-after-clear",
        encodeCacheEnvelope(
          makeEnvelope("new", 60_000, {
            namespaceVersion: version,
          }),
        ),
      );
    };

    await adapter.set("config:old", makeEnvelope("old"));
    await adapter.clearAll();

    expect(await adapter.get("config:written-after-clear")).toMatchObject({
      value: "new",
      namespaceVersion: 1,
    });
  });

  it("Debería adquirir locks con SET NX PX y token único", async () => {
    const lock = await adapter.tryAcquireLock("users:1", 5_000);

    expect(lock).not.toBeNull();
    expect(lock?.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(lock?.expiresAt).toBeGreaterThan(Date.now());
    expect(fake.redis.set).toHaveBeenCalledWith(
      "fk:cache:meta:lock:users:1",
      lock?.token,
      "PX",
      5_000,
      "NX",
    );

    expect(await adapter.tryAcquireLock("users:1", 5_000)).toBeNull();
  });

  it("Debería liberar locks con el script Lua y el token", async () => {
    const lock = await adapter.tryAcquireLock("users:1", 5_000);

    await adapter.releaseLock(lock!);

    expect(fake.redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call"),
      1,
      "fk:cache:meta:lock:users:1",
      lock?.token,
    );
  });

  it("Debería cargar los cinco scripts Lua externos al usarlos", async () => {
    const lock = await adapter.tryAcquireLock("users:1", 5_000);
    expect(lock).not.toBeNull();

    expect(
      await adapter.setWhileHoldingLock("users:1", makeEnvelope("data"), lock!),
    ).toBe(true);
    expect(await adapter.deleteWhileHoldingLock("users:1", lock!)).toBe(true);
    await adapter.releaseLock(lock!);
    await adapter.setVersion("users", 1);

    fake.store.set("fk:cache:entry:users:corrupt", "not-json{");
    expect(await adapter.get("users:corrupt")).toBeNull();

    const scripts = fake.redis.eval.mock.calls.map(([script]) => script);
    expect(scripts).toEqual(
      expect.arrayContaining([
        expect.stringContaining('redis.call("GET", KEYS[1]) == ARGV[1]'),
        expect.stringContaining('redis.call("GET", KEYS[1]) ~= ARGV[1]'),
        expect.stringContaining("local current = tonumber"),
      ]),
    );
    expect(
      scripts.filter((script) => script.includes("redis.call")).length,
    ).toBe(5);
  });

  it("Debería publicar invalidaciones con payload serializado y sourceId", async () => {
    await adapter.publishInvalidation({
      namespace: "users",
      namespaceVersion: 3,
      keys: ["users:1"],
    });

    const payload = JSON.parse(fake.redis.publish.mock.calls[0][1]) as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      namespace: "users",
      namespaceVersion: 3,
      keys: ["users:1"],
    });
    expect(typeof payload.sourceId).toBe("string");
  });

  it("Debería ignorar el eco propio (mismo sourceId) y procesar los ajenos", async () => {
    const handler = vi.fn();
    await adapter.subscribeInvalidation(handler);

    await adapter.publishInvalidation({
      namespace: "users",
      namespaceVersion: 4,
    });
    const ownPayload = fake.redis.publish.mock.calls[0][1];

    fake.emitMessage(CHANNEL, ownPayload); // eco propio
    expect(handler).not.toHaveBeenCalled();

    fake.emitMessage(
      CHANNEL,
      JSON.stringify({
        namespace: "users",
        namespaceVersion: 4,
        sourceId: "another-instance",
      }),
    );
    expect(handler).toHaveBeenCalledWith({
      namespace: "users",
      namespaceVersion: 4,
      sourceId: "another-instance",
    });
  });

  it("Debería suscribir, despachar mensajes válidos e ignorar corruptos", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = vi.fn();

    const unsubscribe = await adapter.subscribeInvalidation(handler);

    expect(fake.redis.duplicate).toHaveBeenCalled();
    expect(fake.redis.subscribe).toHaveBeenCalledWith(CHANNEL);

    fake.emitMessage(
      CHANNEL,
      JSON.stringify({
        namespace: "users",
        namespaceVersion: 4,
        keys: ["users:1"],
      }),
    );
    expect(handler).toHaveBeenCalledWith({
      namespace: "users",
      namespaceVersion: 4,
      keys: ["users:1"],
    });

    fake.emitMessage(CHANNEL, "corrupt{");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();

    await unsubscribe();
    expect(fake.redis.unsubscribe).toHaveBeenCalledWith(CHANNEL);
    expect(fake.redis.quit).toHaveBeenCalled();
  });

  it("Debería reconciliar L1 al recibir ready después de una reconexión", async () => {
    const handler = vi.fn();
    await adapter.subscribeInvalidation(handler);

    fake.emitReady();
    fake.emitReady();
    await new Promise((resolve) => setImmediate(resolve));

    expect(handler).toHaveBeenCalledWith({
      namespace: "*",
      namespaceVersion: 0,
    });
  });

  it("Debería cerrar el subscriber en close() sin tocar la conexión compartida", async () => {
    await adapter.subscribeInvalidation(() => {});

    await adapter.close();

    expect(fake.redis.unsubscribe).toHaveBeenCalledWith(CHANNEL);
    expect(fake.redis.quit).toHaveBeenCalledTimes(1);
  });
});
