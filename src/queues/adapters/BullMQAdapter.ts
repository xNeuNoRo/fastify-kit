import { Queue } from "bullmq";
import { container } from "../../container/DIContainer.js";
import { REDIS_CONNECTION_TOKEN } from "../../distributed/redis.factory.js";
import type { QueueAdapter } from "../interfaces/QueueAdapter.js";
import { BeforeApplicationShutdown } from "../../core/interfaces/lifecycle.interface.js";
import { EVENT_BUS_TOKEN, EventBusContract } from "../../events/EventBus.js";

/**
 * @description Adaptador para BullMQ que permite el uso de colas distribuidas basadas en Redis.
 * Permite que las tareas sean encoladas en una instancia de la aplicación y procesadas por cualquier
 * instancia conectada al mismo servidor de Redis.
 */
export class BullMQAdapter implements QueueAdapter, BeforeApplicationShutdown {
  private readonly queues = new Map<string, Queue>();

  /**
   * @description Obtiene la conexión compartida de Redis desde el contenedor.
   */
  private getRedisConnection() {
    return container.resolve<any>(REDIS_CONNECTION_TOKEN);
  }

  public async dispatch<T>(queueName: string, payload: T): Promise<string> {
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
    for (const queue of this.queues.values()) {
      await queue.close();
    }
  }
}
