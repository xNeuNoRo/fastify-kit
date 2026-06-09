import { Redis } from "ioredis";
import { InternalConfig } from "../config/InternalConfig.js";
import { container } from "../container/DIContainer.js";
import { getLogger } from "../logger/logger.factory.js";

export const REDIS_CONNECTION_TOKEN = Symbol.for("REDIS_CONNECTION_TOKEN");

/**
 * @description Proveedor de fábrica para centralizar la conexión de Redis.
 * Permite que múltiples módulos (Colas, EventBus, Caché) compartan el mismo socket físico.
 */
export function registerRedisConnection() {
  if (container.has(REDIS_CONNECTION_TOKEN)) return;

  container.registerFactory(REDIS_CONNECTION_TOKEN, () => {
    const logger = getLogger();
    const distributedConfig = InternalConfig.get("distributed") || {};
    const redisConfig = distributedConfig.redis || {};

    const connectionOptions = {
      host: redisConfig.host || "localhost",
      port: redisConfig.port || 6379,
      password: redisConfig.password,
      username: redisConfig.username,
      db: redisConfig.db || 0,
      maxRetriesPerRequest: null,
    };

    const redis = new Redis(connectionOptions as any);

    redis.on("error", (err) => {
      logger.error(`[FastifyKit Redis] Error de conexión: ${err.message}`);
    });

    return redis;
  });
}
