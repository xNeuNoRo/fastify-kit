import type { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";

import { InMemoryCacheAdapter } from "../../../src/cache/adapters/InMemoryCacheAdapter.js";
import { RedisCacheAdapter } from "../../../src/cache/adapters/RedisCacheAdapter.js";
import { CacheService } from "../../../src/cache/CacheService.js";
import { buildResolvedCacheConfig } from "../../../src/cache/interfaces/CacheConfig.js";
import { createCacheEnvelope } from "../../../src/cache/interfaces/CacheResult.js";
import {
  Deferred,
  deleteByPattern,
  openRedis,
  waitFor,
} from "../support/redis.js";

const redisForTests = await openRedis();

if (!redisForTests) {
  console.warn(
    "[FastifyKit Cache Test] Saltando pruebas de invalidación distribuida (No se detectó un servidor local en 6379)",
  );
}

const redisIt = redisForTests ? it : it.skip;

const PREFIX = `fk:test:${randomUUID().slice(0, 8)}:`;
const CHANNEL = `${PREFIX}invalidate`;

function makeInstance(
  redis: Redis,
  configOverrides?: Parameters<typeof buildResolvedCacheConfig>[0],
) {
  const l1 = new InMemoryCacheAdapter({ maxSize: 100 });
  const l2 = new RedisCacheAdapter({
    redis,
    keyPrefix: PREFIX,
    invalidationChannel: CHANNEL,
  });
  const service = new CacheService({
    l1,
    l2,
    config: buildResolvedCacheConfig({
      mode: "multi",
      l2: { keyPrefix: PREFIX },
      load: { retryAttempts: 2, retryDelayMs: 10 },
      ...configOverrides,
    }),
  });
  return { service, l1, l2 };
}

describe("Integración invalidación distribuida (dos instancias)", () => {
  let redis: Redis;
  let instanceA: ReturnType<typeof makeInstance>;
  let instanceB: ReturnType<typeof makeInstance>;

  if (redisForTests) {
    beforeAll(() => {
      redis = redisForTests;
    });

    beforeEach(async () => {
      // Instancias frescas por test: los L1 locales no pueden arrastrar versiones
      // de tests anteriores mientras Redis se resetea en afterEach.
      instanceA = makeInstance(redis);
      instanceB = makeInstance(redis);
      await instanceA.service.start();
      await instanceB.service.start();
    });

    afterEach(async () => {
      await instanceA.service.close();
      await instanceB.service.close();
      await deleteByPattern(redis, `${PREFIX}*`);
    });

    afterAll(async () => {
      await redis.quit();
    });
  }

  redisIt(
    "Debería propagar clearNamespace entre instancias y sincronizar versiones",
    async () => {
      // Ambas instancias cargan el mismo dato desde L2.
      expect(
        await instanceA.service.getOrLoad("users:1", () =>
          Promise.resolve("v1"),
        ),
      ).toBe("v1");
      expect(
        await instanceB.service.getOrLoad("users:1", () =>
          Promise.resolve("v1"),
        ),
      ).toBe("v1");
      expect(await instanceB.l1.get("users:1")).not.toBeNull(); // L1 de B poblado

      // Instancia A invalida el namespace.
      await instanceA.service.clearNamespace("users");

      // B limpia su L1 local y la versión queda sincronizada.
      await waitFor(() =>
        instanceB.l1.get("users:1").then((entry) => entry === null),
      );
      expect(await instanceA.service.getVersion("users")).toBe(1);
      expect(await instanceB.service.getVersion("users")).toBe(1);

      // El siguiente acceso recarga desde la fuente (loader ejecutado).
      expect(
        await instanceB.service.getOrLoad("users:1", () =>
          Promise.resolve("v2"),
        ),
      ).toBe("v2");
    },
  );

  redisIt(
    "Debería propagar delete de una clave sin invalidar el resto del namespace",
    async () => {
      await instanceA.service.getOrLoad("users:1", () => Promise.resolve("a"));
      await instanceA.service.getOrLoad("users:2", () => Promise.resolve("b"));
      await instanceB.service.getOrLoad("users:1", () =>
        Promise.resolve("stale"),
      );
      await instanceB.service.getOrLoad("users:2", () =>
        Promise.resolve("stale"),
      );

      await instanceA.service.delete("users:1");

      await waitFor(() =>
        instanceB.l1.get("users:1").then((entry) => entry === null),
      );
      expect(await instanceB.l1.get("users:2")).not.toBeNull();
    },
  );

  redisIt(
    "Debería propagar un set explícito (los L1 remotos se invalidan y releen L2)",
    async () => {
      await instanceB.service.getOrLoad("users:3", () =>
        Promise.resolve("old"),
      );
      expect((await instanceB.l1.get("users:3"))?.value).toBe("old");

      await instanceA.service.set("users:3", {
        value: "new",
        namespaceVersion: 0,
        storedAt: Date.now(),
        freshUntil: Date.now() + 60_000,
        staleUntil: null,
        isNegative: false,
      });

      // B no sirve su L1 obsoleto: relee el valor nuevo desde L2.
      await waitFor(async () => (await instanceB.l1.get("users:3")) === null);
      expect(await instanceB.service.get("users:3")).not.toBeNull();
      expect((await instanceB.service.get("users:3"))?.value).toBe("new");
    },
  );

  redisIt(
    "Debería ignorar el eco propio (sin doble bump de versión local)",
    async () => {
      await instanceA.service.getOrLoad("users:1", () => Promise.resolve("x"));

      await instanceA.service.clearNamespace("users");

      // Si la instancia A procesara su propio eco, la versión local subiría a 2.
      expect(await instanceA.service.getVersion("users")).toBe(1);
      expect(await instanceB.service.getVersion("users")).toBe(1);
    },
  );

  redisIt(
    "Debería duplicar el loader si excede el TTL del lock (sin deadlock)",
    async () => {
      // Instancias con lock TTL corto: la carga de A expira el lock antes de terminar.
      const instanceShortA = makeInstance(redis, { l2: { lockTtlMs: 100 } });
      const instanceShortB = makeInstance(redis, { l2: { lockTtlMs: 100 } });
      await instanceShortA.service.start();
      await instanceShortB.service.start();

      try {
        const loaderStarted = new Deferred<void>();
        const releaseLoader = new Deferred<void>();
        const loader = vi.fn(async () => {
          loaderStarted.resolve();
          await releaseLoader.promise;
          return "data";
        });

        const p1 = instanceShortA.service.getOrLoad("users:1", loader);
        await loaderStarted.promise;
        await waitFor(() =>
          redis
            .exists(`${PREFIX}meta:lock:users:1`)
            .then((exists) => exists === 0),
        );

        const p2 = instanceShortB.service.getOrLoad("users:1", loader);
        releaseLoader.resolve();

        expect(await p1).toBe("data");
        expect(await p2).toBe("data");
        // Duplicación aceptada y documentada: sin deadlock, coherencia por TTL.
        expect(loader).toHaveBeenCalledTimes(2);
      } finally {
        await instanceShortA.service.close();
        await instanceShortB.service.close();
      }
    },
  );

  redisIt(
    "Debería refrescar en segundo plano una entrada stale (stale-while-revalidate real)",
    async () => {
      const stale = createCacheEnvelope({
        value: "stale",
        namespaceVersion: 0,
        storedAt: Date.now() - 60_000,
        freshTtlMs: 10_000,
        staleTtlMs: 600_000,
      });
      await instanceA.l2.set("users:1", stale);

      const loader = vi.fn(() => Promise.resolve("fresh"));

      expect(await instanceB.service.getOrLoad("users:1", loader)).toBe(
        "stale",
      );
      await waitFor(
        async () => (await instanceB.l2.get("users:1"))?.value === "fresh",
      );

      expect(loader).toHaveBeenCalledTimes(1);
      expect((await instanceB.service.get("users:1"))?.value).toBe("fresh");
    },
  );

  redisIt(
    "Debería mantener coherencia eventual sin suscripción activa (at-most-once)",
    async () => {
      // Instancia C SIN start(): no recibe invalidaciones.
      const instanceC = makeInstance(redis);
      await instanceC.service.getOrLoad("users:1", () =>
        Promise.resolve("old"),
      );
      expect((await instanceC.l1.get("users:1"))?.value).toBe("old");

      await instanceA.service.clearNamespace("users");

      // C sigue sirviendo su L1 local (no se enteró): coherencia eventual
      // cubierta por TTL y por la validación de versión en lecturas de L2.
      expect((await instanceC.service.get("users:1"))?.value).toBe("old");

      await instanceC.service.close();
    },
  );

  redisIt(
    "Debería rechazar en L2 envelopes obsoletos por versión (write concurrente)",
    async () => {
      // Escribimos un envelope con versión 0 y luego la versión del namespace sube:
      // simula un writer que leyó la versión ANTES de una invalidación.
      await instanceA.l2.set(
        "users:1",
        createCacheEnvelope({
          value: "stale-write",
          namespaceVersion: 0,
          freshTtlMs: 60_000,
        }),
      );
      await instanceB.service.clearNamespace("users"); // versión → 1

      expect(await instanceB.service.get("users:1")).toBeNull();
      expect(await instanceB.l2.get("users:1")).toBeNull(); // autocurado en L2
    },
  );
});
