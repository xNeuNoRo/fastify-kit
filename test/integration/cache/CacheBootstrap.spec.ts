import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";

import { CacheManager } from "../../../src/cache/CacheManager.js";
import { FastifyKit } from "../../../src/core/FastifyKit.js";
import { Module } from "../../../src/core/module.decorator.js";
import { openRedis } from "../support/redis.js";

const redisForTests = await openRedis();
await redisForTests?.quit();

if (!redisForTests) {
  console.warn(
    "[FastifyKit Cache Test] Saltando pruebas de integración de bootstrap (No se detectó un servidor local en 6379)",
  );
}

const redisIt = redisForTests ? it : it.skip;

@Module({})
class CacheAppModule {}

@Module({})
class NoRedisModule {}

describe("Bootstrap de caché distribuida (FastifyKit.create)", () => {
  redisIt(
    "Debería arrancar con caché multi, operar y cerrar limpio (sin handles)",
    async () => {
      const prefix = `fk:test:${randomUUID().slice(0, 8)}:`;
      const app = await FastifyKit.create({
        module: CacheAppModule,
        fastifyOptions: { logger: false },
        distributed: {
          redis: { host: "localhost", port: 6379 },
          features: {
            cache: {
              mode: "multi",
              l2: { keyPrefix: prefix },
            },
          },
        },
      });

      try {
        await app.ready();

        await CacheManager.set("bootstrap:key", { ok: true }, 30);
        expect(await CacheManager.get("bootstrap:key")).toEqual({ ok: true });

        await CacheManager.getOrLoad("bootstrap:loaded", () =>
          Promise.resolve("loaded"),
        );
        expect(await CacheManager.get("bootstrap:loaded")).toBe("loaded");
      } finally {
        await CacheManager.clearAll();
        await app.close();
      }
    },
  );

  it("Debería fallar en bootstrap si el modo multi no tiene distributed.redis", async () => {
    await expect(
      FastifyKit.create({
        module: NoRedisModule,
        fastifyOptions: { logger: false },
        distributed: {
          features: { cache: { mode: "multi" } },
        },
      }),
    ).rejects.toThrow(/distributed\.redis/);
  });

  it("Debería arrancar con caché multi aunque Redis esté caído (sin colgar)", async () => {
    const app = await FastifyKit.create({
      module: CacheAppModule,
      fastifyOptions: { logger: false },
      distributed: {
        // Puerto sin servidor: la conexión falla en segundo plano y la
        // suscripción de invalidaciones es fire-and-forget.
        redis: { host: "localhost", port: 6399 },
        features: { cache: { mode: "multi" } },
      },
    });

    // El bootstrap resolvió sin colgarse a pesar de Redis caído.
    expect(app).toBeDefined();

    await app.close(); // sin handles colgados
  }, 15_000);

  it("Debería arrancar sin configuración de caché (l1-only por defecto)", async () => {
    const app = await FastifyKit.create({
      module: CacheAppModule,
      fastifyOptions: { logger: false },
    });

    try {
      await app.ready();
      await CacheManager.set("default:key", "value", 30);
      expect(await CacheManager.get("default:key")).toBe("value");
    } finally {
      await app.close();
    }
  });
});
