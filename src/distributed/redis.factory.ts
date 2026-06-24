import { Redis } from "ioredis";
import {
  INTERNAL_CONFIG_SERVICE_TOKEN,
  type InternalConfigService,
} from "../config/InternalConfigService.js";
import { container } from "../container/DIContainer.js";
import { getLogger } from "../logger/logger.factory.js";
import { BeforeApplicationShutdown } from "../core/interfaces/lifecycle.interface.js";
import { Injectable } from "../container/injectable.decorator.js";

export const REDIS_CONNECTION_TOKEN = Symbol.for("REDIS_CONNECTION_TOKEN");

/**
 * @description Gestor de la conexión compartida de Redis.
 * Se encarga de cerrar la conexión física al apagar la aplicación para evitar leaks.
 */
@Injectable()
export class RedisConnectionManager implements BeforeApplicationShutdown {
  private readonly logger = getLogger();

  async beforeApplicationShutdown(): Promise<void> {
    if (container.has(REDIS_CONNECTION_TOKEN)) {
      this.logger.info("[FastifyKit Redis] Cerrando conexión compartida...");
      const redis = container.resolve<Redis>(REDIS_CONNECTION_TOKEN);
      await redis.quit();
    }
  }
}

/**
 * @description Proveedor de fábrica para centralizar la conexión de Redis.
 * Permite que múltiples módulos (Colas, EventBus, Caché) compartan el mismo socket físico.
 */
export function registerRedisConnection() {
  if (container.has(REDIS_CONNECTION_TOKEN)) return;

  container.registerFactory(REDIS_CONNECTION_TOKEN, () => {
    const logger = getLogger();
    const internalConfig = container.resolve<InternalConfigService>(INTERNAL_CONFIG_SERVICE_TOKEN);
    const distributedConfig = internalConfig.get("distributed") || {};
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
