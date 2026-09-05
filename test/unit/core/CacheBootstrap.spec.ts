import { describe, it, expect } from "vitest";

import { CacheService } from "../../../src/cache/CacheService.js";
import {
  CACHE_ADAPTER_TOKEN,
  type CacheAdapter,
} from "../../../src/cache/interfaces/CacheAdapter.js";
import {
  INTERNAL_CONFIG_SERVICE_TOKEN,
  type InternalConfigService,
} from "../../../src/config/InternalConfigService.js";
import { container } from "../../../src/container/DIContainer.js";
import {
  initializeCacheModule,
  initializeDistributedModule,
} from "../../../src/core/bootstrap/modules.bootstrap.js";
import { REDIS_CONNECTION_TOKEN } from "../../../src/distributed/redis.token.js";
import type { Constructor } from "../../../src/http/routing/scanner/index.js";

type CacheProvider = { token: any; implementation: Constructor };

describe("Inicialización del módulo de caché (initializeCacheModule)", () => {
  it("Debería construir el servicio l1-only por defecto y registrarlo como provider", async () => {
    const allProviders: CacheProvider[] = [];

    await initializeCacheModule(allProviders);

    expect(container.has(CACHE_ADAPTER_TOKEN)).toBe(true);
    expect(container.resolve(CACHE_ADAPTER_TOKEN)).toBeInstanceOf(CacheService);
    expect(allProviders.some((p) => p.token === CACHE_ADAPTER_TOKEN)).toBe(
      true,
    );
  });

  it("Debería respetar un CACHE_ADAPTER_TOKEN custom registrado previamente", async () => {
    const customAdapter: CacheAdapter = {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      clearNamespace: () => Promise.resolve(),
      clearAll: () => Promise.resolve(),
      getVersion: () => Promise.resolve(0),
      setVersion: () => Promise.resolve(),
    };
    container.registerInstance(CACHE_ADAPTER_TOKEN, customAdapter);
    const allProviders: CacheProvider[] = [];

    await initializeCacheModule(allProviders);

    expect(container.resolve(CACHE_ADAPTER_TOKEN)).toBe(customAdapter);
    expect(allProviders.some((p) => p.token === CACHE_ADAPTER_TOKEN)).toBe(
      true,
    );
  });

  it("Debería fallar con error accionable si el modo requiere Redis sin configuración", async () => {
    const internalConfig = container.resolve<InternalConfigService>(
      INTERNAL_CONFIG_SERVICE_TOKEN,
    );
    internalConfig.set("distributed", {
      features: { cache: { mode: "multi" } },
    });

    await expect(initializeCacheModule([])).rejects.toThrow(
      /distributed\.redis/,
    );
  });

  it("no debería abrir Redis solo porque exista configuración Redis", async () => {
    const internalConfig = container.resolve<InternalConfigService>(
      INTERNAL_CONFIG_SERVICE_TOKEN,
    );
    internalConfig.set("distributed", {
      redis: { host: "redis.internal" },
    });

    await initializeDistributedModule({ module: class EmptyModule {} }, []);

    expect(container.has(REDIS_CONNECTION_TOKEN)).toBe(false);
  });
});
