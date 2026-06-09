import { Redis } from "ioredis";
import { DefaultEventBus, EventBusContract, EmitOptions } from "./EventBus.js";
import { getLogger } from "../logger/logger.factory.js";
import { BeforeApplicationShutdown } from "../core/interfaces/lifecycle.interface.js";
import { InternalConfig } from "../config/InternalConfig.js";

/**
 * @description Implementación híbrida del EventBus que sincroniza eventos entre instancias usando Redis Pub/Sub.
 * Soporta emisiones locales, globales y dirigidas a instancias específicas.
 */
export class RedisEventBus
  extends DefaultEventBus
  implements EventBusContract, BeforeApplicationShutdown
{
  // ID unico de la instancia
  public readonly instanceId = Math.random().toString(36).substring(7);

  // Funciones pub/sub de Redis para comunicación entre instancias
  private readonly pub: Redis;
  private readonly sub: Redis;

  // Logger para monitoreo de eventos y errores relacionados con Redis
  private readonly logger = getLogger();

  // Canales de Redis para eventos globales y dirigidos
  private readonly globalChannel = "fastify-kit:events:global";
  private readonly personalChannel = `fastify-kit:events:instance:${this.instanceId}`;

  constructor() {
    // Llamamos al constructor de DefaultEventBus para inicializar el EventEmitter interno
    super();

    // Obtenemos la configuración de Redis desde el InternalConfig para establecer las conexiones de Pub/Sub
    const distributedConfig = InternalConfig.get("distributed") || {};
    const redisConfig = distributedConfig.redis || {};

    const connectionOptions = {
      host: redisConfig.host || "localhost",
      port: redisConfig.port || 6379,
      password: redisConfig.password,
      db: redisConfig.db || 0,
    };

    // Inicializamos las conexiones de Redis para publicar y suscribir eventos entre instancias
    this.pub = new Redis(connectionOptions);
    this.sub = new Redis(connectionOptions);

    this.initSubscriber();
    this.logger.info(
      `[FastifyKit RedisEventBus] Inicializado con ID de instancia: ${this.instanceId}`,
    );
  }

  private initSubscriber() {
    // Nos suscribimos al canal global y al canal personal de esta instancia
    this.sub.subscribe(this.globalChannel, this.personalChannel, (err) => {
      if (err) {
        this.logger.error(
          `[FastifyKit RedisEventBus] Error al suscribirse: ${err.message}`,
        );
      }
    });

    this.sub.on("message", (channel, message) => {
      try {
        const { eventName, payload, _sourceId } = JSON.parse(message);

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
  }

  /**
   * @description Emite un evento, pudiendo dirigirlo localmente (por defecto), globalmente o a una instancia específica.
   */
  emit(eventName: string, payload?: any, options?: EmitOptions): void {
    const target = options?.target || "local";

    // Siempre disparamos localmente si el destino es "local", "global" o explícitamente nuestra propia instancia.
    // Esto asegura que la instancia emisora reaccione inmediatamente sin esperar el roundtrip a Redis.
    if (
      target === "local" ||
      target === "global" ||
      target === this.instanceId
    ) {
      super.emit(eventName, payload);
    }

    // Si solo era local, retornamos aquí para evitar propagar a Redis.
    if (target === "local") return;

    // Propagamos via Redis (Global o Dirigida)
    const message = JSON.stringify({
      eventName,
      payload,
      _sourceId: this.instanceId,
    });

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
    this.logger.info("[FastifyKit RedisEventBus] Cerrando conexiones Redis...");
    await Promise.allSettled([this.pub.quit(), this.sub.quit()]);
  }
}
