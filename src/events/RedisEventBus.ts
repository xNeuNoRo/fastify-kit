import type { Redis } from "ioredis";

import { container } from "../container/DIContainer.js";
import {
  BeforeApplicationShutdown,
  OnApplicationBootstrap,
} from "../core/interfaces/lifecycle.interface.js";
import { getLogger } from "../logger/logger.factory.js";
import { REDIS_CONNECTION_TOKEN } from "../distributed/redis.token.js";
import { closeRedisConnection } from "../distributed/redis.lifecycle.js";
import { DefaultEventBus, EventBusContract, EmitOptions } from "./EventBus.js";

/**
 * @description Implementación híbrida del EventBus que sincroniza eventos entre instancias usando Redis Pub/Sub.
 * Soporta emisiones locales, globales y dirigidas a instancias específicas.
 *
 * Ownership de conexiones:
 * - `pub`: la conexión compartida central (`REDIS_CONNECTION_TOKEN`), propiedad de RedisConnectionManager.
 * - `sub`: conexión dedicada creada con `duplicate()` (una conexión en modo suscripción
 *   no puede ejecutar comandos normales como PUBLISH). Se cierra en beforeApplicationShutdown.
 */
export class RedisEventBus
  extends DefaultEventBus
  implements EventBusContract, OnApplicationBootstrap, BeforeApplicationShutdown
{
  // ID unico de la instancia
  private readonly _instanceId = Math.random().toString(36).substring(7);
  override get instanceId() {
    return this._instanceId;
  }

  // Funciones pub/sub de Redis para comunicación entre instancias
  private readonly pub: Redis;
  private readonly sub: Redis;

  // Logger para monitoreo de eventos y errores relacionados con Redis
  private readonly logger = getLogger();
  private readonly initialization: Promise<void>;
  private ready = false;
  private closing?: Promise<void>;

  // Canales de Redis para eventos globales y dirigidos
  private readonly globalChannel = "fastify-kit:events:global";
  private readonly personalChannel = `fastify-kit:events:instance:${this.instanceId}`;

  constructor() {
    // Llamamos al constructor de DefaultEventBus para inicializar el EventEmitter interno
    super();

    // Obtenemos la conexión compartida para publicar
    this.pub = container.resolve<Redis>(REDIS_CONNECTION_TOKEN);

    // El suscriptor es una conexión dedicada con las mismas opciones que la compartida.
    // duplicate() evita duplicar la construcción de opciones de conexión.
    this.sub = this.pub.duplicate({
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.sub.on("error", (err) => {
      this.logger.error(
        `[FastifyKit RedisEventBus] Error en la conexión de suscripción: ${err.message}`,
      );
    });
    this.sub.on("ready", () => {
      if (!this.closing) this.ready = true;
    });

    this.initialization = this.initSubscriber();
    // El hook de ciclo de vida informa del fallo. Evitamos que una promesa
    // rechazada creada por el constructor quede sin controlar para usuarios directos.
    void this.initialization.catch(() => {});
    this.logger.info(
      `[FastifyKit RedisEventBus] Inicializado con ID de instancia: ${this.instanceId}`,
    );
  }

  private async initSubscriber(): Promise<void> {
    this.sub.on("message", (channel, message) => {
      try {
        // Extraemos el mensaje restaurando automáticamente los Buffers binarios si existiesen
        const { eventName, payload, _sourceId } = JSON.parse(
          message,
          (key, value) => {
            if (value?._fk_type === "Buffer") {
              return Buffer.from(value.data, "base64");
            }
            return value;
          },
        );

        // Evitamos disparar localmente si nosotros mismos emitimos el evento en el canal global
        // (porque en emit() ya lo disparamos localmente para ser más rápidos)
        if (channel === this.globalChannel && _sourceId === this.instanceId) {
          return;
        }

        // Si es un mensaje del canal global (de otra instancia) o del canal personal, lo disparamos localmente
        super.emit(eventName, payload);
      } catch (e) {
        this.logger.error(
          `[FastifyKit RedisEventBus] Error procesando mensaje de Redis en canal ${channel}: ${e}`,
        );
      }
    });

    // Registramos el handler antes de suscribirnos para que ningún mensaje pueda
    // llegar durante el intervalo entre el reconocimiento de Redis y la configuración
    // del listener.
    await this.waitForSubscriberReady();
    await this.sub.subscribe(this.globalChannel, this.personalChannel);
    this.ready = true;
  }

  private async waitForSubscriberReady(): Promise<void> {
    const status = (this.sub as Redis & { status?: string }).status;
    if (status === undefined || status === "ready") return;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.sub.removeListener("ready", onReady);
        reject(new Error("Redis EventBus subscriber readiness timed out."));
      }, 1_000);
      const onReady = () => {
        clearTimeout(timeout);
        this.sub.removeListener("ready", onReady);
        resolve();
      };
      this.sub.once("ready", onReady);
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.initialization;
  }

  async waitUntilReady(): Promise<void> {
    await this.initialization;
  }

  /**
   * @description Emite un evento, pudiendo directo localmente (por defecto), globalmente o a una instancia específica.
   */
  emit(eventName: string, payload?: unknown, options?: EmitOptions): void {
    if (this.closing) return;
    const target = options?.target || "local";

    // Siempre disparamos localmente si el destino es "local", "global" o explícitamente nuestra propia instancia.
    // Esto asegura que la instancia emisora reaccione inmediatamente sin esperar el
    // viaje de ida y vuelta a Redis.
    if (
      target === "local" ||
      target === "global" ||
      target === this.instanceId
    ) {
      super.emit(eventName, payload);
    }

    // Si solo era local o dirigido a esta instancia, retornamos aquí para evitar propagar a Redis.
    if (target === "local" || target === this.instanceId) return;

    // Propagamos via Redis (Global o Dirigida) detectando si hay instancias de Buffer para codificarlas a Base64
    const message = JSON.stringify(
      {
        eventName,
        payload,
        _sourceId: this.instanceId,
      },
      function (key, value) {
        if (this[key] instanceof Buffer) {
          return {
            _fk_type: "Buffer",
            data: this[key].toString("base64"),
          };
        }
        return value;
      },
    );

    // Determinamos el canal de Redis según el destino: global o dirigido a una instancia específica.
    const targetChannel =
      target === "global"
        ? this.globalChannel
        : `fastify-kit:events:instance:${target}`;

    this.pub.publish(targetChannel, message).catch((err) => {
      this.logger.error(
        `[FastifyKit RedisEventBus] Error publicando en Redis (${targetChannel}): ${err.message}`,
      );
    });
  }

  /**
   * @description Cierra las conexiones de Redis al detener la app
   */
  public async beforeApplicationShutdown(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      this.ready = false;
      this.logger.info(
        "[FastifyKit RedisEventBus] Cerrando suscripción Redis...",
      );
      await closeRedisConnection(this.sub).catch(() => {});
      // No cerramos 'this.pub' aquí porque es la conexión compartida central.
    })();
    return this.closing;
  }
}
