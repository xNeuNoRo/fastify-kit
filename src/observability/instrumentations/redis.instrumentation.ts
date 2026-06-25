import type { DIContainer } from "../../container/DIContainer.js";
import type { TracerService } from "../contracts/TracerService.js";
import type { MetricsService } from "../contracts/MetricsService.js";
import {
  SEMATTR_DB_SYSTEM,
  SEMATTR_DB_REDIS_COMMAND,
  SEMATTR_DB_REDIS_KEY,
} from "../utils/semantic-conventions.js";
import {
  SEMVAL_DB_SYSTEM_REDIS,
} from "../utils/semantic-conventions.js";
import { SpanKind, SpanStatusCode } from "../contracts/TracerService.js";
import { REDIS_CONNECTION_TOKEN } from "../../distributed/redis.factory.js";

let originalFactory: ((c: DIContainer) => any) | null = null;

export function instrumentRedisConnection(
  container: DIContainer,
  tracer: TracerService,
  metrics: MetricsService,
): void {
  if (!container.has(REDIS_CONNECTION_TOKEN)) return;

  try {
    const redis = container.resolve<any>(REDIS_CONNECTION_TOKEN);
    if (!redis || redis.__otelPatched) return;

    const originalCommand = redis.command?.bind(redis);
    if (!originalCommand) return;

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
          const duration =
            Number(process.hrtime.bigint() - start) / 1e9;
          metrics.histogram("redis_command_duration_seconds", duration, {
            command: command.toLowerCase(),
            status: "ok",
          });
          span.setStatus(SpanStatusCode.OK);
          span.end();
          return result;
        })
        .catch((err: any) => {
          const duration =
            Number(process.hrtime.bigint() - start) / 1e9;
          metrics.histogram("redis_command_duration_seconds", duration, {
            command: command.toLowerCase(),
            status: "error",
          });
          span.recordException(err);
          span.end();
          throw err;
        });
    };

    (redis as any).__otelPatched = true;
  } catch {
    // Redis not available or already instrumented
  }
}
