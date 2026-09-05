import type { Redis } from "ioredis";

import { getLogger } from "../../logger/logger.factory.js";
import type { CacheInvalidationMessage } from "../interfaces/DistributedCacheAdapter.js";
import { CacheCodecError } from "./CacheEnvelopeCodec.js";
import { decodeInvalidationMessage } from "./CacheInvalidationCodec.js";

/**
 * @description Suscriptor dedicado del canal de invalidaciones de caché.
 *
 * Ownership: crea su propia conexión con `duplicate()` (una conexión en modo
 * suscripción no puede ejecutar comandos normales). El cierre es explícito
 * (`stop()`): desuscribe y hace `quit()`, sin tocar la conexión compartida.
 *
 * Garantías declaradas:
 * - Pub/Sub es at-most-once: sin replay ni durabilidad. Un mensaje perdido
 *   mientras la instancia está caída queda cubierto por TTL/versión.
 * - Los mensajes malformados se ignoran con warning sin romper el loop.
 * - Los errores del handler se capturan y registran (nunca quedan como rechazos
 *   de promesas no controlados).
 */
export class CacheInvalidationSubscriber {
  private subscriber: Redis | null = null;
  private readonly logger = getLogger();
  private startPromise?: Promise<void>;
  private active = false;
  private processing = false;
  private readonly pending: CacheInvalidationMessage[] = [];
  private readonly pendingByNamespace = new Map<
    string,
    CacheInvalidationMessage
  >();
  private handler?: (message: CacheInvalidationMessage) => void | Promise<void>;

  private static readonly MAX_PENDING_MESSAGES = 1_024;
  private static readonly START_TIMEOUT_MS = 1_000;
  private static readonly STOP_TIMEOUT_MS = 250;

  /**
   * @param channel Canal de invalidaciones a suscribir.
   * @param sourceId Identificador de esta instancia: los mensajes publicados
   * por ella misma se ignoran (el emisor ya aplicó su limpieza local y
   * procesar el eco re-bumparía su versión, divergiendo de la remota).
   */
  constructor(
    private readonly channel: string,
    private readonly sourceId: string,
  ) {}

  /**
   * @description Inicia la suscripción al canal de invalidaciones.
   * Idempotente: si ya hay una suscripción activa, no crea otra conexión.
   *
   * NO bloquea el bootstrap: la suscripción se hace en segundo plano. Si Redis está
   * caído, se reintenta con la cola offline (reintentos acotados) y el error se
   * loguea; las invalidaciones perdidas quedan cubiertas por TTL/versión
   * (Pub/Sub es at-most-once).
   *
   * @param connection Conexión compartida (se duplica para el suscriptor).
   * @param handler Invocado por cada mensaje válido.
   */
  async start(
    connection: Redis,
    handler: (message: CacheInvalidationMessage) => void | Promise<void>,
    onReconnect?: () => void | Promise<void>,
  ): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.subscriber && this.active) return;

    // La conexión compartida usa maxRetriesPerRequest: null (requisito BullMQ),
    // lo que encolaría los comandos indefinidamente con Redis caído. El suscriptor
    // acota los reintentos (20 = valor por defecto de ioredis) para no colgar el bootstrap.
    const subscriber = connection.duplicate({
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.subscriber = subscriber;
    this.handler = handler;
    let wasReady = false;

    subscriber.on("message", (channel, message) => {
      if (channel !== this.channel) return;

      let parsed: CacheInvalidationMessage;
      try {
        parsed = decodeInvalidationMessage(message);
      } catch (error) {
        if (error instanceof CacheCodecError) {
          this.logger.warn(
            `[FastifyKit Cache] Mensaje de invalidación ignorado: ${error.message}`,
          );
        } else {
          this.logger.error(
            `[FastifyKit Cache] Error procesando mensaje de invalidación: ${
              (error as Error).message
            }`,
          );
        }
        return;
      }

      // Eco propio: esta instancia ya aplicó la limpieza local al originar
      // la invalidación. Ignorarlo evita doble limpieza y divergencia de versiones.
      if (parsed.sourceId === this.sourceId) {
        return;
      }

      this.enqueue(parsed);
    });

    subscriber.on("error", (err) => {
      this.logger.error(
        `[FastifyKit Cache] Error en la conexión de suscripción de invalidaciones: ${err.message}`,
      );
    });

    subscriber.on("ready", () => {
      if (!wasReady) {
        wasReady = true;
        return;
      }
      try {
        void Promise.resolve(onReconnect?.()).catch((error: unknown) => {
          this.logger.warn(
            `[FastifyKit Cache] No se pudo reconciliar la L1 tras reconectar Redis: ${(error as Error).message}`,
          );
        });
      } catch (error) {
        this.logger.warn(
          `[FastifyKit Cache] No se pudo reconciliar la L1 tras reconectar Redis: ${(error as Error).message}`,
        );
      }
    });

    const initialization = this.waitForSubscriberReady(subscriber)
      .then(() =>
        this.withTimeout(
          Promise.resolve().then(() => subscriber.subscribe(this.channel)),
          CacheInvalidationSubscriber.START_TIMEOUT_MS,
        ),
      )
      .then(() => {
        this.active = true;
      })
      .catch(async (error: unknown) => {
        this.logger.error(
          `[FastifyKit Cache] Error al suscribirse al canal de invalidaciones: ${(error as Error).message}`,
        );
        await this.stopSubscriber(subscriber);
        if (this.subscriber === subscriber) this.subscriber = null;
        this.active = false;
        throw error;
      });

    this.startPromise = initialization;
    const connectionStatus = (connection as Redis & { status?: string }).status;
    const status = (subscriber as Redis & { status?: string }).status;
    if (
      connectionStatus === "ready" ||
      status === undefined ||
      status === "ready"
    ) {
      try {
        await initialization;
      } finally {
        if (this.startPromise === initialization) {
          this.startPromise = undefined;
        }
      }
      return;
    }

    // Un suscriptor que aún está conectando no debe hacer que el bootstrap de la
    // caché espere a Redis. `stop()` sigue esperando esta promesa para que el cierre
    // sea determinista.
    void initialization.then(
      () => {
        if (this.startPromise === initialization) this.startPromise = undefined;
      },
      () => {
        if (this.startPromise === initialization) this.startPromise = undefined;
      },
    );
  }

  isActive(): boolean {
    return this.active && this.subscriber !== null;
  }

  /**
   * @description Detiene la suscripción y cierra la conexión dedicada.
   * Idempotente y tolerante a errores de red durante el cierre.
   */
  async stop(): Promise<void> {
    if (this.startPromise) await this.startPromise.catch(() => {});
    const subscriber = this.subscriber;
    if (!subscriber) return;
    this.subscriber = null;
    this.active = false;
    this.pending.length = 0;
    this.pendingByNamespace.clear();

    await this.withTimeout(
      subscriber.unsubscribe(this.channel),
      CacheInvalidationSubscriber.STOP_TIMEOUT_MS,
    ).catch(() => {});
    await this.stopSubscriber(subscriber);
  }

  private enqueue(message: CacheInvalidationMessage): void {
    const existing = this.pendingByNamespace.get(message.namespace);
    if (existing) {
      this.mergePending(existing, message);
      return;
    }

    if (
      this.pending.length >= CacheInvalidationSubscriber.MAX_PENDING_MESSAGES
    ) {
      // Dropping a key-level message could leave stale L1 data. Collapse the
      // Colapsamos la cola acotada en una invalidación global segura.
      const namespaceVersion = Math.max(
        message.namespaceVersion,
        ...this.pending.map((pending) => pending.namespaceVersion),
      );
      this.pending.length = 0;
      this.pendingByNamespace.clear();
      message = { namespace: "*", namespaceVersion };
    }

    this.pending.push(message);
    this.pendingByNamespace.set(message.namespace, message);
    void this.drain();
  }

  private mergePending(
    target: CacheInvalidationMessage,
    incoming: CacheInvalidationMessage,
  ): void {
    target.namespaceVersion = Math.max(
      target.namespaceVersion,
      incoming.namespaceVersion,
    );
    // A namespace-wide invalidation is the safe merge when either message is
    // already namespace-wide. Otherwise preserve the union of both key sets.
    // Keeping only the intersection could lose a key when the later message
    // contains more keys than the pending one.
    if (target.keys === undefined || incoming.keys === undefined) {
      delete target.keys;
      return;
    }

    target.keys = [...new Set([...target.keys, ...incoming.keys])];
  }

  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.pending.length > 0) {
        const message = this.pending.shift()!;
        try {
          await this.handler?.(message);
        } catch (error) {
          this.logger.error(
            `[FastifyKit Cache] Error en el handler de invalidación: ${(error as Error).message}`,
          );
        } finally {
          if (this.pendingByNamespace.get(message.namespace) === message) {
            this.pendingByNamespace.delete(message.namespace);
          }
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async stopSubscriber(subscriber: Redis): Promise<void> {
    try {
      await this.withTimeout(
        Promise.resolve().then(() => subscriber.quit()),
        CacheInvalidationSubscriber.STOP_TIMEOUT_MS,
      );
    } catch {
      const disconnect = (subscriber as Redis & { disconnect?: () => void })
        .disconnect;
      disconnect?.call(subscriber);
    }
    subscriber.removeAllListeners?.();
  }

  private async waitForSubscriberReady(subscriber: Redis): Promise<void> {
    const status = (subscriber as Redis & { status?: string }).status;
    if (status === undefined || status === "ready") return;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        subscriber.removeListener("ready", onReady);
        reject(new Error("Redis cache subscriber readiness timed out."));
      }, CacheInvalidationSubscriber.START_TIMEOUT_MS);
      const onReady = () => {
        clearTimeout(timeout);
        subscriber.removeListener("ready", onReady);
        resolve();
      };
      subscriber.once("ready", onReady);
    });
  }

  private async withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Redis subscriber operation timed out.")),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
