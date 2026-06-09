import { Queue, ConnectionOptions } from "bullmq";
import { InternalConfig } from "../../config/InternalConfig.js";
import type { QueueAdapter } from "../interfaces/QueueAdapter.js";
import { getLogger } from "../../logger/logger.factory.js";
import { BeforeApplicationShutdown } from "../../core/interfaces/lifecycle.interface.js";

/**
 * @description Adaptador para BullMQ que permite el uso de colas distribuidas basadas en Redis.
 * Permite que las tareas sean encoladas en una instancia de la aplicación y procesadas por cualquier
 * instancia conectada al mismo servidor de Redis.
 */
export class BullMQAdapter implements QueueAdapter, BeforeApplicationShutdown {
  private readonly queues = new Map<string, Queue>();
  private readonly redisConnection: ConnectionOptions;

  private readonly logger = getLogger();

  constructor() {
    const distributedConfig = InternalConfig.get("distributed") || {};
    const redisConfig = distributedConfig.redis || {};

    const connectionOptions: ConnectionOptions = {
      host: redisConfig.host || "localhost",
      port: redisConfig.port || 6379,
      password: redisConfig.password,
      username: redisConfig.username,
      db: redisConfig.db || 0,
      maxRetriesPerRequest: null, // Para evitar que BullMQ falle si Redis se reinicia
    };

    this.redisConnection = connectionOptions;
  }

  public async dispatch<T>(queueName: string, payload: T): Promise<string> {
    let queue = this.queues.get(queueName);

    if (!queue) {
      queue = new Queue(queueName, { connection: this.redisConnection });
      this.queues.set(queueName, queue);
    }

    const job = await queue.add(queueName, payload, {
      removeOnComplete: true,
      removeOnFail: false,
    });

    return job.id || "";
  }

  /**
   * @description Registra un nuevo procesador. Para BullMQ, esto simplemente asegura que la conexión esté lista.
   * El procesamiento real se maneja en el QueueWorkerManager.
   */
  public registerProcessor(queueName: string): void {
    if (!this.queues.has(queueName)) {
      const queue = new Queue(queueName, { connection: this.redisConnection });
      this.queues.set(queueName, queue);
    }
  }

  /**
   * @description Cierra las conexiones de las colas y de Redis al apagar la aplicación.
   */
  public async beforeApplicationShutdown(): Promise<void> {
    this.logger.info("[FastifyKit BullMQ] Cerrando conexiones de colas...");
    for (const queue of this.queues.values()) {
      await queue.close();
    }
  }
}
