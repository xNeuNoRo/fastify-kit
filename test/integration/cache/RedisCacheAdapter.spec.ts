import type { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";

import { RedisCacheAdapter } from "../../../src/cache/adapters/RedisCacheAdapter.js";
import { createCacheEnvelope } from "../../../src/cache/interfaces/CacheResult.js";
import type { CacheInvalidationMessage } from "../../../src/cache/interfaces/DistributedCacheAdapter.js";
import {
  Deferred,
  deleteByPattern,
  openRedis,
  waitFor,
} from "../support/redis.js";

const redisForTests = await openRedis();

if (!redisForTests) {
  console.warn(
    "[FastifyKit Cache Test] Saltando pruebas de integración Redis (No se detectó un servidor local en 6379)",
  );
}

const redisIt = redisForTests ? it : it.skip;

const PREFIX = `fk:test:${randomUUID().slice(0, 8)}:`;
const CHANNEL = `${PREFIX}invalidate`;

function makeEnvelope(value: unknown, ttlMs = 60_000) {
  return createCacheEnvelope({
    value,
    namespaceVersion: 0,
    freshTtlMs: ttlMs,
    staleTtlMs: ttlMs * 10,
  });
}

describe("Integración RedisCacheAdapter (L2)", () => {
  let redis: Redis;
  let adapter: RedisCacheAdapter | undefined;

  if (redisForTests) {
    beforeAll(() => {
      redis = redisForTests;
    });

    afterAll(async () => {
      await redis.quit();
    });
  }

  afterEach(async () => {
    await adapter?.close().catch(() => {});
    if (redis) await deleteByPattern(redis, `${PREFIX}*`);
    adapter = undefined;
  });

  redisIt("Debería persistir envelopes con TTL físico real", async () => {
    adapter = new RedisCacheAdapter({
      redis,
      keyPrefix: PREFIX,
      invalidationChannel: CHANNEL,
    });

    const withTtl = createCacheEnvelope({
      value: "data",
      namespaceVersion: 0,
      freshTtlMs: 10_000,
    });
    await adapter.set("users:1", withTtl);
    const pttl = await redis.pttl(`${PREFIX}entry:users:1`);
    expect(pttl).toBeGreaterThan(8_000);
    expect(pttl).toBeLessThanOrEqual(10_000);

    const permanent = createCacheEnvelope({
      value: "forever",
      namespaceVersion: 0,
      freshTtlMs: null,
    });
    await adapter.set("users:2", permanent);
    expect(await redis.pttl(`${PREFIX}entry:users:2`)).toBe(-1);
  });

  redisIt(
    "Debería adquirir y liberar locks con exclusión entre instancias",
    async () => {
      const adapterA = new RedisCacheAdapter({
        redis,
        keyPrefix: PREFIX,
        invalidationChannel: CHANNEL,
      });
      const adapterB = new RedisCacheAdapter({
        redis,
        keyPrefix: PREFIX,
        invalidationChannel: CHANNEL,
      });
      adapter = adapterA;

      const lockA = await adapterA.tryAcquireLock("users:1", 5_000);
      expect(lockA).not.toBeNull();
      expect(await adapterB.tryAcquireLock("users:1", 5_000)).toBeNull();

      await adapterA.releaseLock(lockA!);
      const lockB = await adapterB.tryAcquireLock("users:1", 5_000);
      expect(lockB).not.toBeNull();
      await adapterB.releaseLock(lockB!);
      await adapterB.close();
    },
  );

  redisIt("Debería expirar locks por TTL (sin deadlock)", async () => {
    const adapterA = new RedisCacheAdapter({
      redis,
      keyPrefix: PREFIX,
      invalidationChannel: CHANNEL,
    });
    const adapterB = new RedisCacheAdapter({
      redis,
      keyPrefix: PREFIX,
      invalidationChannel: CHANNEL,
    });
    adapter = adapterA;

    const lockA = await adapterA.tryAcquireLock("users:1", 100);
    expect(lockA).not.toBeNull();

    await waitFor(() =>
      redis.exists(`${PREFIX}meta:lock:users:1`).then((exists) => exists === 0),
    );

    const lockB = await adapterB.tryAcquireLock("users:1", 5_000);
    expect(lockB).not.toBeNull();
    await adapterB.releaseLock(lockB!);
    await adapterB.close();
  });

  redisIt(
    "Debería propagar invalidaciones entre dos instancias por Pub/Sub",
    async () => {
      const adapterA = new RedisCacheAdapter({
        redis,
        keyPrefix: PREFIX,
        invalidationChannel: CHANNEL,
      });
      const adapterB = new RedisCacheAdapter({
        redis,
        keyPrefix: PREFIX,
        invalidationChannel: CHANNEL,
      });
      adapter = adapterA;

      const received: CacheInvalidationMessage[] = [];
      const unsubscribe = await adapterA.subscribeInvalidation((message) => {
        received.push(message);
      });

      await adapterB.publishInvalidation({
        namespace: "users",
        namespaceVersion: 7,
      });
      await adapterB.delete("users:1");

      await waitFor(() => received.length >= 2);

      expect(received).toContainEqual(
        expect.objectContaining({ namespace: "users", namespaceVersion: 7 }),
      );
      expect(received).toContainEqual(
        expect.objectContaining({
          namespace: "users",
          namespaceVersion: 0,
          keys: ["users:1"],
        }),
      );
      expect(
        received.every((message) => typeof message.sourceId === "string"),
      ).toBe(true);

      await unsubscribe();
      await adapterB.close();
    },
  );

  redisIt(
    "Debería limpiar namespaces, bumpar versión y aislar prefijos",
    async () => {
      adapter = new RedisCacheAdapter({
        redis,
        keyPrefix: PREFIX,
        invalidationChannel: CHANNEL,
      });
      const otherPrefix = `${PREFIX}other:`;
      const otherAdapter = new RedisCacheAdapter({
        redis,
        keyPrefix: otherPrefix,
        invalidationChannel: CHANNEL,
      });

      await adapter.set("users:1", makeEnvelope("a"));
      await adapter.set("users:2", makeEnvelope("b"));
      await adapter.set("users_premium:1", makeEnvelope("c"));
      await otherAdapter.set("users:1", makeEnvelope("isolated"));

      await adapter.clearNamespace("users");

      expect(await adapter.get("users:1")).toBeNull();
      expect(await adapter.get("users:2")).toBeNull();
      expect((await adapter.get("users_premium:1"))?.value).toBe("c");
      expect(await adapter.getVersion("users")).toBe(1);
      expect((await otherAdapter.get("users:1"))?.value).toBe("isolated");

      await otherAdapter.close();
    },
  );

  redisIt("Debería autocorregir entradas corruptas en Redis real", async () => {
    adapter = new RedisCacheAdapter({
      redis,
      keyPrefix: PREFIX,
      invalidationChannel: CHANNEL,
    });

    await redis.set(`${PREFIX}entry:users:1`, "not-json{");

    expect(await adapter.get("users:1")).toBeNull();
    expect(await redis.get(`${PREFIX}entry:users:1`)).toBeNull();
  });

  redisIt(
    "Debería rechazar y autocurar envelopes físicamente presentes pero lógicamente expirados",
    async () => {
      adapter = new RedisCacheAdapter({
        redis,
        keyPrefix: PREFIX,
        invalidationChannel: CHANNEL,
      });
      const expired = createCacheEnvelope({
        value: "expired",
        namespaceVersion: 0,
        storedAt: Date.now() - 10_000,
        freshTtlMs: 1_000,
        staleTtlMs: 2_000,
      });
      await redis.set(
        `${PREFIX}entry:users:expired`,
        JSON.stringify({
          _v: 1,
          ...expired,
        }),
      );

      expect(await adapter.get("users:expired")).toBeNull();
      expect(await redis.exists(`${PREFIX}entry:users:expired`)).toBe(0);
    },
  );

  redisIt(
    "Debería impedir que un lock expirado escriba sobre el propietario actual",
    async () => {
      const adapterA = new RedisCacheAdapter({
        redis,
        keyPrefix: PREFIX,
        invalidationChannel: CHANNEL,
      });
      const adapterB = new RedisCacheAdapter({
        redis,
        keyPrefix: PREFIX,
        invalidationChannel: CHANNEL,
      });
      adapter = adapterA;

      const expiredOwner = await adapterA.tryAcquireLock("users:1", 100);
      expect(expiredOwner).not.toBeNull();
      await waitFor(() =>
        redis
          .exists(`${PREFIX}meta:lock:users:1`)
          .then((exists) => exists === 0),
      );

      const currentOwner = await adapterB.tryAcquireLock("users:1", 5_000);
      expect(currentOwner).not.toBeNull();
      expect(
        await adapterA.setWhileHoldingLock(
          "users:1",
          makeEnvelope("stale-owner"),
          expiredOwner!,
        ),
      ).toBe(false);
      expect(
        await adapterB.setWhileHoldingLock(
          "users:1",
          makeEnvelope("current-owner"),
          currentOwner!,
        ),
      ).toBe(true);
      await adapterB.releaseLock(currentOwner!);
      await adapterB.close();

      expect((await adapterA.get("users:1"))?.value).toBe("current-owner");
    },
  );

  redisIt(
    "Debería mantener monotonicidad de versiones bajo concurrencia real",
    async () => {
      adapter = new RedisCacheAdapter({
        redis,
        keyPrefix: PREFIX,
        invalidationChannel: CHANNEL,
      });
      const requested = Array.from({ length: 100 }, (_, index) =>
        index % 2 === 0 ? index + 1 : 100 - index,
      );

      await Promise.all(
        requested.map((version) => adapter!.setVersion("users", version)),
      );

      expect(await adapter.getVersion("users")).toBe(Math.max(...requested));
    },
  );

  redisIt(
    "Debería conservar físicamente un write que ocurre después del scan y antes del bump",
    async () => {
      const deletionStarted = new Deferred<void>();
      const releaseDeletion = new Deferred<void>();
      const commandRedis = redis.duplicate({
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
      commandRedis.on("error", () => {});
      const originalDelete = commandRedis.del.bind(commandRedis);
      let paused = false;
      Object.defineProperty(commandRedis, "del", {
        configurable: true,
        value: async (...keys: string[]) => {
          const result = await originalDelete(...keys);
          if (!paused) {
            paused = true;
            deletionStarted.resolve();
            await releaseDeletion.promise;
          }
          return result;
        },
      });
      const facade = new Proxy(redis, {
        get(target, property, receiver) {
          if (property === "duplicate") return () => commandRedis;
          return Reflect.get(target, property, receiver);
        },
      });
      adapter = new RedisCacheAdapter({
        redis: facade,
        keyPrefix: PREFIX,
        invalidationChannel: CHANNEL,
      });
      await adapter.set("users:old", makeEnvelope("old"));

      const clearing = adapter.clearNamespace("users");
      await deletionStarted.promise;
      await redis.set(
        `${PREFIX}entry:users:late-write`,
        JSON.stringify({
          _v: 1,
          ...makeEnvelope("late-write"),
        }),
      );
      releaseDeletion.resolve();
      await clearing;

      expect(await redis.exists(`${PREFIX}entry:users:late-write`)).toBe(1);
      expect(await adapter.get("users:late-write")).toBeNull();
      await commandRedis.quit();
    },
  );
});
