import type { Redis } from "ioredis";

const DEFAULT_REDIS_SHUTDOWN_TIMEOUT_MS = 1_000;

/**
 * Cierra una conexión Redis sin permitir que una interrupción mantenga bloqueado
 * el cierre de la aplicación indefinidamente. Se prefiere `quit()` para que las
 * respuestas pendientes puedan completarse; el socket se desconecta por la fuerza
 * cuando el cierre ordenado supera el límite establecido.
 */
export async function closeRedisConnection(
  redis: Redis,
  timeoutMs = DEFAULT_REDIS_SHUTDOWN_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let graceful = false;
  try {
    await Promise.race([
      redis.quit(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Redis shutdown timed out.")),
          timeoutMs,
        );
      }),
    ]);
    graceful = true;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (!graceful) {
      const disconnect = (redis as Redis & { disconnect?: () => void })
        .disconnect;
      disconnect?.call(redis);
    }
  }
}
