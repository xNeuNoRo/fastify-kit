import { describe, it, expect, vi } from "vitest";

import {
  INTERNAL_CONFIG_SERVICE_TOKEN,
  type InternalConfigService,
} from "../../../src/config/InternalConfigService.js";
import { container } from "../../../src/container/DIContainer.js";
import {
  registerRedisConnection,
  RedisConnectionManager,
  type RedisModule,
} from "../../../src/distributed/redis.factory.js";
import { buildRedisConnectionOptions } from "../../../src/distributed/redis.options.js";
import { REDIS_CONNECTION_TOKEN } from "../../../src/distributed/redis.token.js";

function makeFakeRedisLoader() {
  let instances = 0;
  let lastOptions: Record<string, unknown> | undefined;

  const loadRedis: () => Promise<RedisModule> = () => {
    class FakeRedis {
      constructor(options: Record<string, unknown>) {
        instances++;
        lastOptions = options;
      }
      on() {
        return this;
      }
      duplicate() {
        return this;
      }
      quit() {
        return Promise.resolve("OK");
      }
    }
    return Promise.resolve({ Redis: FakeRedis } as unknown as RedisModule);
  };

  return {
    loadRedis,
    instances: () => instances,
    lastOptions: () => lastOptions,
  };
}

describe("Opciones de conexión Redis (buildRedisConnectionOptions)", () => {
  it("Debería resolver los defaults sin configuración", () => {
    expect(buildRedisConnectionOptions()).toEqual({
      host: "localhost",
      port: 6379,
      password: undefined,
      username: undefined,
      db: 0,
    });
  });

  it("Debería preservar la configuración explícita", () => {
    expect(
      buildRedisConnectionOptions({
        host: "redis.internal",
        port: 6380,
        password: "secret",
        username: "svc",
        db: 2,
      }),
    ).toEqual({
      host: "redis.internal",
      port: 6380,
      password: "secret",
      username: "svc",
      db: 2,
    });
  });
});

describe("Registro de conexión compartida (registerRedisConnection)", () => {
  // El setup global (test/setup.ts) ya registra CONFIG/INTERNAL con
  // DefaultConfigService antes de cada test; cada test setea su config distribuida.
  it("Debería registrar la conexión con las opciones de la configuración distribuida", async () => {
    const internalConfig = container.resolve<InternalConfigService>(
      INTERNAL_CONFIG_SERVICE_TOKEN,
    );
    internalConfig.set("distributed", {
      redis: { host: "redis.internal", port: 6380 },
    });

    const fake = makeFakeRedisLoader();
    await registerRedisConnection(fake.loadRedis);

    expect(container.has(REDIS_CONNECTION_TOKEN)).toBe(true);
    expect(fake.instances()).toBe(1);
    expect(fake.lastOptions()).toMatchObject({
      host: "redis.internal",
      port: 6380,
      maxRetriesPerRequest: null,
    });
  });

  it("Debería ser idempotente: no recrear la conexión si ya existe", async () => {
    const internalConfig = container.resolve<InternalConfigService>(
      INTERNAL_CONFIG_SERVICE_TOKEN,
    );
    internalConfig.set("distributed", { redis: { host: "localhost" } });

    const fake = makeFakeRedisLoader();
    await registerRedisConnection(fake.loadRedis);
    await registerRedisConnection(fake.loadRedis);

    expect(fake.instances()).toBe(1);
  });

  it("Debería lanzar un error accionable si no se puede cargar 'ioredis'", async () => {
    await expect(
      registerRedisConnection(() => Promise.reject(new Error("not found"))),
    ).rejects.toThrow(/npm install ioredis/);
  });

  it("Debería fallar sin registrar el token si el loader falla", async () => {
    await registerRedisConnection(() =>
      Promise.reject(new Error("not found")),
    ).catch(() => {});

    expect(container.has(REDIS_CONNECTION_TOKEN)).toBe(false);
  });
});

describe("Cierre de la conexión compartida de Redis", () => {
  it("debería cerrar y desregistrar la conexión creada por el framework", async () => {
    const internalConfig = container.resolve<InternalConfigService>(
      INTERNAL_CONFIG_SERVICE_TOKEN,
    );
    internalConfig.set("distributed", { redis: { host: "localhost" } });
    const fake = makeFakeRedisLoader();
    await registerRedisConnection(fake.loadRedis);

    await new RedisConnectionManager().onApplicationShutdown();

    expect(container.has(REDIS_CONNECTION_TOKEN)).toBe(false);
  });

  it("no cierra una conexión Redis registrada externamente", async () => {
    const quit = vi.fn(async () => {});
    const redis = { quit };
    container.registerInstance(REDIS_CONNECTION_TOKEN, redis as never);

    await new RedisConnectionManager().onApplicationShutdown();

    expect(quit).not.toHaveBeenCalled();
    expect(container.has(REDIS_CONNECTION_TOKEN)).toBe(true);
  });
});
