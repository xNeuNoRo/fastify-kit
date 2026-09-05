import { describe, it, expect } from "vitest";

import {
  buildResolvedCacheConfig,
  DEFAULT_RESOLVED_CACHE_CONFIG,
  getCacheLayerRequirements,
} from "../../../src/cache/interfaces/CacheConfig.js";
import {
  createCacheEnvelope,
  getEnvelopeFreshness,
  isEnvelopeExpired,
} from "../../../src/cache/interfaces/CacheResult.js";
import type { DistributedCacheOptions } from "../../../src/core/interfaces/cache.interface.js";

describe("Configuración de caché (buildResolvedCacheConfig)", () => {
  it("Debería resolver los defaults cuando no se provee configuración", () => {
    const config = buildResolvedCacheConfig();

    expect(config).toEqual(DEFAULT_RESOLVED_CACHE_CONFIG);
    expect(config.mode).toBe("l1-only");
    expect(config.l1.maxSize).toBe(10_000);
    expect(config.l1.defaultTtlMs).toBe(60_000);
    expect(config.l2.keyPrefix).toBe("fk:cache:");
    expect(config.l2.defaultTtlMs).toBe(300_000);
    expect(config.l2.staleTtlMs).toBe(3_600_000);
    expect(config.l2.negativeTtlMs).toBe(30_000);
    expect(config.l2.lockTtlMs).toBe(5_000);
    expect(config.l2.operationTimeoutMs).toBe(500);
    expect(config.l2.failureThreshold).toBe(3);
    expect(config.l2.recoveryTimeoutMs).toBe(30_000);
    expect(config.l2.mutationWaitMs).toBe(1_000);
    expect(config.load.maxConcurrent).toBe(16);
    expect(config.load.maxWaiters).toBe(100);
    expect(config.load.retryAttempts).toBe(3);
    expect(config.load.retryDelayMs).toBe(50);
    expect(config.load.maxQueuedLoads).toBe(1_000);
    expect(config.onRedisError).toBe("bypass-l1");
    expect(config.namespaces).toEqual({});
  });

  it("Debería devolver una copia para no mutar los defaults globales", () => {
    const config = buildResolvedCacheConfig();

    config.l1.maxSize = 1;
    config.namespaces["hack"] = {
      mode: "multi",
      allowStale: true,
      l1TtlMs: null,
      l2TtlMs: null,
      staleTtlMs: null,
      onRedisError: "bypass-l1",
    };

    expect(DEFAULT_RESOLVED_CACHE_CONFIG.l1.maxSize).toBe(10_000);
    expect(DEFAULT_RESOLVED_CACHE_CONFIG.namespaces).toEqual({});
  });

  it("Debería resolver una configuración completa con namespaces", () => {
    const userOptions: DistributedCacheOptions = {
      mode: "multi",
      l1: { maxSize: 5_000, defaultTtlSeconds: 30 },
      l2: {
        keyPrefix: "app:cache:",
        defaultTtlSeconds: 600,
        staleTtlSeconds: 7_200,
        negativeTtlSeconds: 10,
        lockTtlMs: 8_000,
      },
      load: {
        maxConcurrent: 8,
        maxWaiters: 50,
        retryAttempts: 5,
        retryDelayMs: 100,
        maxQueuedLoads: 50,
      },
      onRedisError: "stale-if-error",
      namespaces: {
        sessions: {
          mode: "l2-only",
          allowStale: false,
          l2TtlSeconds: 1_800,
          onRedisError: "fail",
        },
        products: { l1TtlSeconds: 15, staleTtlSeconds: 7_200 },
      },
    };

    const config = buildResolvedCacheConfig(userOptions);

    expect(config.mode).toBe("multi");
    expect(config.l1.maxSize).toBe(5_000);
    expect(config.l1.defaultTtlMs).toBe(30_000);
    expect(config.l2.keyPrefix).toBe("app:cache:");
    expect(config.l2.defaultTtlMs).toBe(600_000);
    expect(config.l2.staleTtlMs).toBe(7_200_000);
    expect(config.l2.negativeTtlMs).toBe(10_000);
    expect(config.l2.lockTtlMs).toBe(8_000);
    expect(config.l2.operationTimeoutMs).toBe(500);
    expect(config.l2.failureThreshold).toBe(3);
    expect(config.l2.recoveryTimeoutMs).toBe(30_000);
    expect(config.l2.mutationWaitMs).toBe(1_000);
    expect(config.load.maxConcurrent).toBe(8);
    expect(config.load.maxWaiters).toBe(50);
    expect(config.load.retryAttempts).toBe(5);
    expect(config.load.retryDelayMs).toBe(100);
    expect(config.load.maxQueuedLoads).toBe(50);
    expect(config.onRedisError).toBe("stale-if-error");

    expect(config.namespaces["sessions"]).toEqual({
      mode: "l2-only",
      allowStale: false,
      onRedisError: "fail",
      l1TtlMs: null,
      l2TtlMs: 1_800_000,
      staleTtlMs: null,
    });
    expect(config.namespaces["products"]).toEqual({
      mode: "multi",
      allowStale: true,
      onRedisError: "stale-if-error",
      l1TtlMs: 15_000,
      l2TtlMs: null,
      staleTtlMs: 7_200_000,
    });
  });

  it("Debería heredar el modo global cuando el namespace no define el suyo", () => {
    const config = buildResolvedCacheConfig({
      mode: "multi",
      namespaces: { users: {} },
    });

    expect(config.namespaces["users"].mode).toBe("multi");
  });

  it("Debería materializar las capas requeridas por overrides de namespace", () => {
    const l1FromNamespace = buildResolvedCacheConfig({
      mode: "l2-only",
      namespaces: { local: { mode: "l1-only" } },
    });
    expect(getCacheLayerRequirements(l1FromNamespace)).toEqual({
      needsL1: true,
      needsL2: true,
    });

    const l2FromNamespace = buildResolvedCacheConfig({
      mode: "l1-only",
      namespaces: { shared: { mode: "l2-only" } },
    });
    expect(getCacheLayerRequirements(l2FromNamespace)).toEqual({
      needsL1: true,
      needsL2: true,
    });
  });

  it("Debería rechazar configuraciones numéricas inválidas", () => {
    expect(() => buildResolvedCacheConfig({ l1: { maxSize: -1 } })).toThrow(
      /FastifyKit Cache/,
    );
    expect(() =>
      buildResolvedCacheConfig({ l1: { defaultTtlSeconds: 0 } }),
    ).toThrow(/FastifyKit Cache/);
    expect(() => buildResolvedCacheConfig({ l2: { lockTtlMs: 0 } })).toThrow(
      /FastifyKit Cache/,
    );
    expect(() =>
      buildResolvedCacheConfig({ l2: { defaultTtlSeconds: Number.NaN } }),
    ).toThrow(/FastifyKit Cache/);
    expect(() =>
      buildResolvedCacheConfig({ load: { maxConcurrent: 0 } }),
    ).toThrow(/FastifyKit Cache/);
    expect(() =>
      buildResolvedCacheConfig({ load: { maxWaiters: 1.5 } }),
    ).toThrow(/FastifyKit Cache/);
    expect(() =>
      buildResolvedCacheConfig({ load: { retryDelayMs: -10 } }),
    ).toThrow(/FastifyKit Cache/);
    expect(() =>
      buildResolvedCacheConfig({ l2: { operationTimeoutMs: 0 } }),
    ).toThrow(/FastifyKit Cache/);
    expect(() =>
      buildResolvedCacheConfig({ load: { maxQueuedLoads: 0 } }),
    ).toThrow(/FastifyKit Cache/);
  });

  it("Debería rechazar modos de caché no soportados", () => {
    expect(() =>
      buildResolvedCacheConfig({ mode: "invalid" as never }),
    ).toThrow(/FastifyKit Cache/);
    expect(() =>
      buildResolvedCacheConfig({
        namespaces: { users: { mode: "invalid" as never } },
      }),
    ).toThrow(/FastifyKit Cache/);
  });

  it("Debería rechazar keyPrefix vacío, inseguro y namespaces vacíos", () => {
    expect(() =>
      buildResolvedCacheConfig({ l2: { keyPrefix: "   " } }),
    ).toThrow(/FastifyKit Cache/);
    expect(() =>
      buildResolvedCacheConfig({ l2: { keyPrefix: "app:*:" } }),
    ).toThrow(/FastifyKit Cache/);
    expect(() =>
      buildResolvedCacheConfig({ l2: { keyPrefix: " app: " } }),
    ).toThrow(/FastifyKit Cache/);
    expect(() => buildResolvedCacheConfig({ namespaces: { "": {} } })).toThrow(
      /FastifyKit Cache/,
    );
  });

  it("Debería rechazar ventanas stale menores que el TTL fresco", () => {
    expect(() =>
      buildResolvedCacheConfig({
        l2: { defaultTtlSeconds: 300, staleTtlSeconds: 120 },
      }),
    ).toThrow(/FastifyKit Cache/);
  });

  it("Debería rechazar políticas Redis desconocidas y TTL stale de namespace incoherentes", () => {
    expect(() =>
      buildResolvedCacheConfig({ onRedisError: "unknown" as never }),
    ).toThrow(/onRedisError/);
    expect(() =>
      buildResolvedCacheConfig({
        l2: { defaultTtlSeconds: 300, staleTtlSeconds: 900 },
        namespaces: { users: { l2TtlSeconds: 1_000, staleTtlSeconds: 900 } },
      }),
    ).toThrow(/staleTtlSeconds/);
  });

  it("Debería rechazar TTLs de namespace inválidos", () => {
    expect(() =>
      buildResolvedCacheConfig({
        namespaces: { users: { l1TtlSeconds: -5 } },
      }),
    ).toThrow(/FastifyKit Cache/);
  });
});

describe("Envelope de caché (createCacheEnvelope)", () => {
  it("Debería crear una entrada permanente cuando el TTL es nulo", () => {
    const envelope = createCacheEnvelope({
      value: { id: 1 },
      namespaceVersion: 0,
      freshTtlMs: null,
    });

    expect(envelope.value).toEqual({ id: 1 });
    expect(envelope.namespaceVersion).toBe(0);
    expect(envelope.freshUntil).toBeNull();
    expect(envelope.staleUntil).toBeNull();
    expect(envelope.isNegative).toBe(false);
    expect(envelope.storedAt).toBeGreaterThan(0);
  });

  it("Debería calcular freshUntil y staleUntil a partir de los TTLs", () => {
    const envelope = createCacheEnvelope({
      value: "data",
      namespaceVersion: 3,
      storedAt: 1_000,
      freshTtlMs: 60_000,
      staleTtlMs: 3_600_000,
    });

    expect(envelope.storedAt).toBe(1_000);
    expect(envelope.freshUntil).toBe(61_000);
    expect(envelope.staleUntil).toBe(3_601_000);
  });

  it("Debería normalizar el TTL total stale para que nunca termine antes que fresh", () => {
    const envelope = createCacheEnvelope({
      value: "data",
      namespaceVersion: 0,
      storedAt: 1_000,
      freshTtlMs: 60_000,
      staleTtlMs: 10_000,
    });

    expect(envelope.freshUntil).toBe(61_000);
    expect(envelope.staleUntil).toBe(61_000);
  });

  it("Debería ignorar una ventana stale cuando la entrada fresca es permanente", () => {
    const envelope = createCacheEnvelope({
      value: "data",
      namespaceVersion: 0,
      storedAt: 1_000,
      freshTtlMs: null,
      staleTtlMs: 60_000,
    });

    expect(envelope.freshUntil).toBeNull();
    expect(envelope.staleUntil).toBeNull();
  });

  it("Debería tratar TTLs cero o negativos como sin ventana", () => {
    const noStale = createCacheEnvelope({
      value: 1,
      namespaceVersion: 0,
      storedAt: 1_000,
      freshTtlMs: 60_000,
      staleTtlMs: 0,
    });
    const noFresh = createCacheEnvelope({
      value: 1,
      namespaceVersion: 0,
      storedAt: 1_000,
      freshTtlMs: 0,
      staleTtlMs: 60_000,
    });

    expect(noStale.staleUntil).toBeNull();
    expect(noFresh.freshUntil).toBeNull();
  });

  it("Debería marcar entradas negativas", () => {
    const envelope = createCacheEnvelope({
      value: null,
      namespaceVersion: 0,
      freshTtlMs: 30_000,
      isNegative: true,
    });

    expect(envelope.isNegative).toBe(true);
  });
});

describe("Frescura de envelope (isEnvelopeExpired / getEnvelopeFreshness)", () => {
  const now = 100_000;

  it("Debería considerar que una entrada permanente nunca expira", () => {
    const permanent = createCacheEnvelope({
      value: 1,
      namespaceVersion: 0,
      storedAt: 0,
      freshTtlMs: null,
    });

    expect(isEnvelopeExpired(permanent, now)).toBe(false);
    expect(getEnvelopeFreshness(permanent, now)).toBe("fresh");
  });

  it("Debería clasificar una entrada dentro de su ventana fresca", () => {
    const envelope = createCacheEnvelope({
      value: 1,
      namespaceVersion: 0,
      storedAt: 10_000,
      freshTtlMs: 60_000,
      staleTtlMs: 3_600_000,
    });

    expect(isEnvelopeExpired(envelope, 50_000)).toBe(false);
    expect(getEnvelopeFreshness(envelope, 50_000)).toBe("fresh");
  });

  it("Debería clasificar como stale una entrada en la ventana stale", () => {
    const envelope = createCacheEnvelope({
      value: 1,
      namespaceVersion: 0,
      storedAt: 10_000,
      freshTtlMs: 60_000,
      staleTtlMs: 3_600_000,
    });

    expect(isEnvelopeExpired(envelope, 200_000)).toBe(false);
    expect(getEnvelopeFreshness(envelope, 200_000)).toBe("stale");
  });

  it("Debería considerar expirada una entrada más allá de la ventana stale", () => {
    const envelope = createCacheEnvelope({
      value: 1,
      namespaceVersion: 0,
      storedAt: 10_000,
      freshTtlMs: 60_000,
      staleTtlMs: 3_600_000,
    });

    expect(isEnvelopeExpired(envelope, 3_700_000)).toBe(true);
  });

  it("Debería expirar al vencer freshUntil cuando no hay ventana stale", () => {
    const envelope = createCacheEnvelope({
      value: 1,
      namespaceVersion: 0,
      storedAt: 10_000,
      freshTtlMs: 60_000,
    });

    expect(isEnvelopeExpired(envelope, 70_001)).toBe(true);
  });
});
