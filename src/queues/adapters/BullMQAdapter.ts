import type { Redis } from "ioredis";
import { ConnectionOptions, Queue } from "bullmq";

import { container } from "../../container/DIContainer.js";
import { REDIS_CONNECTION_TOKEN } from "../../distributed/redis.token.js";
import { BeforeApplicationShutdown } from "../../core/interfaces/lifecycle.interface.js";
import { EVENT_BUS_TOKEN, EventBusContract } from "../../events/EventBus.js";
import type { QueueAdapter } from "../interfaces/QueueAdapter.js";

/**
 * @description Adaptador para BullMQ que permite el uso de colas distribuidas basadas en Redis.
 * Permite que las tareas sean encoladas en una instancia de la aplicación y procesadas por cualquier
 * instancia conectada al mismo servidor de Redis.
 */
export class BullMQAdapter implements QueueAdapter, BeforeApplicationShutdown {
  private readonly queues = new Map<string, Queue>();
  private closing?: Promise<void>;

  /**
   * @description Obtiene la conexión compartida de Redis desde el contenedor.
   * El cast a ConnectionOptions es necesario porque BullMQ tipa contra su propia
   * copia de ioredis; en runtime acepta la instancia compartida.
   */
  private getRedisConnection(): ConnectionOptions {
    return container.resolve<Redis>(
      REDIS_CONNECTION_TOKEN,
    ) as unknown as ConnectionOptions;
  }

  public async dispatch<T>(queueName: string, payload: T): Promise<string> {
    if (this.closing) {
      throw new Error("[FastifyKit BullMQAdapter] El adaptador está cerrado.");
    }
    let queue = this.queues.get(queueName);

    if (!queue) {
      queue = new Queue(queueName, {
        connection: this.getRedisConnection(),
      });
      this.queues.set(queueName, queue);
    }

    // Resolvemos el bus para obtener nuestro instanceId y poder recibir la respuesta dirigida
    const eventBus = container.resolve<EventBusContract>(EVENT_BUS_TOKEN);

    // Envolvemos el payload con metadata interna de FastifyKit
    const wrappedPayload = {
      _fk_metadata: {
        sourceId: eventBus.instanceId,
      },
      data: payload,
    };

    const job = await queue.add(queueName, wrappedPayload, {
      removeOnComplete: true,
      removeOnFail: false,
    });

    if (job.id === undefined || job.id === null) {
      throw new Error(
        `[FastifyKit BullMQAdapter] BullMQ no retornó un job.id válido para la cola '${queueName}'.`,
      );
    }

    return String(job.id);
  }

  /**
   * @description Registra un nuevo procesador asegurando que la cola esté inicializada.
   */
  public registerProcessor(queueName: string): void {
    if (this.closing) {
      throw new Error("[FastifyKit BullMQAdapter] El adaptador está cerrado.");
    }
    if (!this.queues.has(queueName)) {
      const queue = new Queue(queueName, {
        connection: this.getRedisConnection(),
      });
      this.queues.set(queueName, queue);
    }
  }

  /**
   * @description Cierra las colas al detener la app.
   */
  public async beforeApplicationShutdown(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      const queues = [...this.queues.values()];
      this.queues.clear();
      await Promise.allSettled(queues.map((queue) => queue.close()));
    })();
    return this.closing;
  }
}
