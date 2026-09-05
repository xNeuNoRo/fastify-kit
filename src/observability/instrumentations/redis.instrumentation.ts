import type { DIContainer } from "../../container/DIContainer.js";
import type { TracerService } from "../contracts/TracerService.js";
import type { MetricsService } from "../contracts/MetricsService.js";
import {
  SEMATTR_DB_SYSTEM,
  SEMATTR_DB_REDIS_COMMAND,
  SEMATTR_DB_REDIS_KEY,
} from "../utils/semantic-conventions.js";
import { SEMVAL_DB_SYSTEM_REDIS } from "../utils/semantic-conventions.js";
import { SpanKind, SpanStatusCode } from "../contracts/TracerService.js";
import { REDIS_CONNECTION_TOKEN } from "../../distributed/redis.token.js";

/**
 * @description Instrumenta automáticamente los comandos de Redis (ioredis)
 * para registrar spans de traza y métricas de latencia.
 *
 * Envuelve el método redis.command() capturando:
 * - Nombre del comando (SET, GET, HSET, etc.)
 * - Clave de Redis accedida
 * - Duración del comando en segundos (histograma)
 * - Estado (ok/error) según el resultado
 *
 * Métricas registradas:
 * - redis_command_duration_seconds{command, status}
 *
 * Atributos semánticos:
 * - db.system: "redis"
 * - db.redis.command: nombre del comando (minúsculas)
 * - db.redis.key: clave accedida (primer argumento)
 *
 * @param container Contenedor DI para resolver la conexión Redis
 * @param tracer Servicio de trazas para crear spans CLIENT
 * @param metrics Servicio de métricas para el histograma
 */
export function instrumentRedisConnection(
  container: DIContainer,
  tracer: TracerService,
  metrics: MetricsService,
): void {
  if (!container.has(REDIS_CONNECTION_TOKEN)) return;

  try {
    const redis = container.resolve<any>(REDIS_CONNECTION_TOKEN);
    if (!redis || redis.__otelPatched) return;

    // Guardamos referencia al comando original para usarlo en el wrapper
    const originalCommand = redis.command?.bind(redis);
    if (!originalCommand) return;

    /**
     * Wrapper que crea un span CLIENT por cada comando Redis.
     * Mide latencia y registra métricas.
     */
    redis.command = function (command: string, ...args: any[]) {
      const start = process.hrtime.bigint();
      const span = tracer.startSpan(`redis.${command}`, {
        kind: SpanKind.CLIENT,
        attributes: {
          [SEMATTR_DB_SYSTEM]: SEMVAL_DB_SYSTEM_REDIS,
          [SEMATTR_DB_REDIS_COMMAND]: command,
          [SEMATTR_DB_REDIS_KEY]: String(args[0] || ""),
        },
      });

      return originalCommand(command, ...args)
        .then((result: any) => {
          const duration = Number(process.hrtime.bigint() - start) / 1e9;
          metrics.histogram("redis_command_duration_seconds", duration, {
            command: command.toLowerCase(),
            status: "ok",
          });
          span.setStatus(SpanStatusCode.OK);
          span.end();
          return result;
        })
        .catch((err: any) => {
          const duration = Number(process.hrtime.bigint() - start) / 1e9;
          metrics.histogram("redis_command_duration_seconds", duration, {
            command: command.toLowerCase(),
            status: "error",
          });
          span.recordException(err);
          span.end();
          throw err;
        });
    };

    // Marcamos como instrumentado para no volver a parchear
    (redis as any).__otelPatched = true;
  } catch {
    // Redis no disponible o ya instrumentado
  }
}
