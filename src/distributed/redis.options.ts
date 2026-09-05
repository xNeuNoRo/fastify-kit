import type { RedisOptions } from "ioredis";
import type { RedisConnectionOptions } from "../core/interfaces/distributed.interface.js";

/**
 * @description Construye las opciones de conexión ioredis a partir de la
 * configuración pública de `distributed.redis`.
 *
 * Es el único lugar donde se resuelven los defaults de conexión, para que la
 * conexión compartida (redis.factory) y los subscribers dedicados (RedisEventBus)
 * no puedan divergir (host, port, username, password, db).
 *
 * Solo importa tipos de ioredis: no carga el paquete en runtime.
 */
export function buildRedisConnectionOptions(
  config: RedisConnectionOptions = {},
): RedisOptions {
  return {
    host: config.host || "localhost",
    port: config.port || 6379,
    password: config.password,
    username: config.username,
    db: config.db ?? 0,
  };
}
