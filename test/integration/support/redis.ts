import { Redis } from "ioredis";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 6379;
const DEFAULT_TIMEOUT_MS = 2_000;

export const requireRedis = process.env.FASTIFY_KIT_REQUIRE_REDIS === "1";

export async function openRedis(): Promise<Redis | null> {
  const redis = new Redis({
    host: process.env.FASTIFY_KIT_REDIS_HOST ?? DEFAULT_HOST,
    port: Number(process.env.FASTIFY_KIT_REDIS_PORT ?? DEFAULT_PORT),
    db: Number(process.env.FASTIFY_KIT_REDIS_DB ?? 0),
    // Igualamos las conexiones de producción: duplicate() debe heredar un cliente
    // eager; de lo contrario, los adaptadores con enableOfflineQueue=false no estarán listos.
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: DEFAULT_TIMEOUT_MS,
    retryStrategy: () => null,
  });

  redis.on("error", () => {
    // Las comprobaciones de salud informan del fallo; aquí los errores de ioredis
    // se mantienen silenciosos de forma intencionada.
  });

  try {
    if (redis.status !== "ready") {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Redis readiness timed out.")),
          DEFAULT_TIMEOUT_MS,
        );
        const onReady = () => {
          clearTimeout(timeout);
          redis.removeListener("error", onError);
          resolve();
        };
        const onError = (error: Error) => {
          clearTimeout(timeout);
          redis.removeListener("ready", onReady);
          reject(error);
        };
        redis.once("ready", onReady);
        redis.once("error", onError);
      });
    }
    if ((await redis.ping()) !== "PONG") {
      throw new Error("Redis health check returned a non-PONG response.");
    }
    return redis;
  } catch (error) {
    redis.disconnect();
    if (requireRedis) {
      throw new Error(
        "Redis integration tests require a reachable Redis server. Set FASTIFY_KIT_REDIS_HOST/PORT or start the test service.",
        { cause: error },
      );
    }
    return null;
  }
}

export async function deleteByPattern(
  redis: Redis,
  pattern: string,
): Promise<void> {
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      100,
    );
    if (keys.length > 0) await redis.del(...keys);
    cursor = nextCursor;
  } while (cursor !== "0");
}

export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number; message?: string } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const intervalMs = options.intervalMs ?? 10;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    options.message ?? `Condition timed out after ${timeoutMs}ms.`,
  );
}

export class Deferred<T = void> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;

  constructor() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    this.promise = new Promise<T>((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });
    this.resolve = resolve;
    this.reject = reject;
  }
}
