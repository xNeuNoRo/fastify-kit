import type { Redis, RedisOptions } from "ioredis";

import { Injectable } from "../container/injectable.decorator.js";
import { container } from "../container/DIContainer.js";
import {
  INTERNAL_CONFIG_SERVICE_TOKEN,
  type InternalConfigService,
} from "../config/InternalConfigService.js";
import { OnApplicationShutdown } from "../core/interfaces/lifecycle.interface.js";
import { getLogger } from "../logger/logger.factory.js";
import { buildRedisConnectionOptions } from "./redis.options.js";
import { REDIS_CONNECTION_TOKEN } from "./redis.token.js";
import { closeRedisConnection } from "./redis.lifecycle.js";
import {
  claimApplicationResource,
  releaseApplicationResource,
} from "../core/application-context.js";

export { REDIS_CONNECTION_TOKEN } from "./redis.token.js";

const ownedRedisConnections = new WeakSet<object>();

/**
 * @description Forma del módulo ioredis (cargado dinámicamente).
 * Se define de forma reducida porque ioredis es CJS y el import dinámico
 * expone `{ Redis, default, print, ... }`; `typeof import("ioredis")` no
 * coincide con la forma real de la interoperabilidad.
 */
export type RedisModule = {
  Redis: new (options: RedisOptions) => Redis;
};

/**
 * @description Gestor de la conexión compartida de Redis.
 * Se encarga de cerrar la conexión física al apagar la aplicación para evitar leaks.
 */
@Injectable()
export class RedisConnectionManager implements OnApplicationShutdown {
  private readonly logger = getLogger();
  private closing?: Promise<void>;

  async onApplicationShutdown(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      if (!container.has(REDIS_CONNECTION_TOKEN)) return;
      const redis = container.resolve<Redis>(REDIS_CONNECTION_TOKEN);
      if (!ownedRedisConnections.has(redis)) {
        releaseApplicationResource(redis);
        return;
      }

      this.logger.info("[FastifyKit Redis] Cerrando conexión compartida...");
      try {
        await closeRedisConnection(redis);
      } finally {
        ownedRedisConnections.delete(redis);
        releaseApplicationResource(redis);
        container.unregister(REDIS_CONNECTION_TOKEN);
      }
    })();
    return this.closing;
  }
}

/**
 * @description Proveedor de fábrica para centralizar la conexión de Redis.
 * Permite que múltiples módulos (Colas, EventBus, Caché) compartan el mismo socket físico.
 *
 * La conexión compartida usa `maxRetriesPerRequest: null` porque es el requisito
 * de BullMQ para colas distribuidas; los subscribers dedicados (EventBus, caché)
 * se crean con `duplicate()` y heredan las mismas opciones de conexión.
 *
 * 'ioredis' es un peer opcional: se carga dinámicamente SOLO cuando se registra
 * la conexión. Si falta, se lanza un error accionable.
 *
 * @param loadRedis Loader inyectable del módulo ioredis (por defecto el import dinámico).
 */
export async function registerRedisConnection(
  loadRedis: () => Promise<RedisModule> = () => import("ioredis"),
): Promise<void> {
  if (container.has(REDIS_CONNECTION_TOKEN)) {
    const existing = container.resolve<Redis>(REDIS_CONNECTION_TOKEN);
    claimApplicationResource(existing, "Redis connection");
    return;
  }
  if (redisInitialization) return redisInitialization;

  const initialization = buildRedisConnection(loadRedis);
  redisInitialization = initialization;
  try {
    await initialization;
  } finally {
    if (redisInitialization === initialization) redisInitialization = undefined;
  }
}

let redisInitialization: Promise<void> | undefined;

async function buildRedisConnection(
  loadRedis: () => Promise<RedisModule>,
): Promise<void> {
  if (container.has(REDIS_CONNECTION_TOKEN)) return;

  const internalConfig = container.resolve<InternalConfigService>(
    INTERNAL_CONFIG_SERVICE_TOKEN,
  );
  const distributedConfig = internalConfig.get("distributed") || {};
  const connectionOptions = buildRedisConnectionOptions(
    distributedConfig.redis,
  );

  let Redis: RedisModule["Redis"];
  try {
    ({ Redis } = await loadRedis());
  } catch (error) {
    throw new Error(
      "[FastifyKit Redis] No se pudo cargar la dependencia opcional 'ioredis'. Instálala para usar funcionalidades distribuidas:\n\nnpm install ioredis",
      { cause: error },
    );
  }

  const redis = new Redis({
    ...connectionOptions,
    maxRetriesPerRequest: null,
  });
  ownedRedisConnections.add(redis);
  claimApplicationResource(redis, "Redis connection");

  redis.on("error", (err) => {
    getLogger().error(`[FastifyKit Redis] Error de conexión: ${err.message}`);
  });

  container.registerInstance(REDIS_CONNECTION_TOKEN, redis);
}
