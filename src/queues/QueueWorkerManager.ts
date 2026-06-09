import { Worker, ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";
import { QueueRegistry } from "./QueueRegistry.js";
import { WorkerPool } from "./workers/WorkerPool.js";
import { getLogger } from "../logger/logger.factory.js";
import { Injectable } from "../container/injectable.decorator.js";
import {
  OnApplicationBootstrap,
  BeforeApplicationShutdown,
} from "../core/interfaces/lifecycle.interface.js";
import { container } from "../container/DIContainer.js";
import { getEventBus } from "../events/eventbus.factory.js";
import { InternalConfig } from "../config/InternalConfig.js";

/**
 * @description Gestor de Workers distribuidos para BullMQ.
 * Escucha las colas registradas en el QueueRegistry y delega el procesamiento
 * al WorkerPool local (multihilo) para maximizar el uso de recursos.
 */
@Injectable()
export class QueueWorkerManager
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly workers: Worker[] = [];
  private redisConnection?: Redis;
  private readonly logger = getLogger();

  public async onApplicationBootstrap(): Promise<void> {
    const config = InternalConfig.get("queue") || {};
    const distributedConfig = InternalConfig.get("distributed");

    if (config.strategy !== "redis") return;
    if (!distributedConfig?.redis) {
      this.logger.error(
        "[FastifyKit] Seleccionaste la estrategia 'redis' pero no se encontró configuración alguna de Redis.",
      );
      return;
    }

    // Configuramos la conexión a Redis para los Workers de BullMQ
    const redisConfig = distributedConfig.redis || {};
    const connectionOptions: ConnectionOptions = {
      host: redisConfig.host || "localhost",
      port: redisConfig.port || 6379,
      password: redisConfig.password,
      username: redisConfig.username,
      db: redisConfig.db || 0,
      maxRetriesPerRequest: null,
    };
    this.redisConnection = new Redis(connectionOptions as any);

    // Obtenemos el WorkerPool local para delegar la ejecución de tareas en hilos paralelos
    const workerPool = container.resolve(WorkerPool);

    // Obtenemos todas las colas registradas por el scanner
    const registeredQueues = QueueRegistry.getRegisteredQueues();

    for (const queueName of registeredQueues) {
      this.logger.debug(
        `[FastifyKit Queue] Iniciando Worker distribuido para la cola: ${queueName}`,
      );

      const worker = new Worker(
        queueName,
        async (job) => {
          // Delegamos la ejecución al WorkerPool local (hilos paralelos)
          const result = await workerPool.execute(queueName, job.data);

          // Emitimos un evento global con el resultado
          const eventBus = getEventBus();
          eventBus.emit(
            `job.done:${queueName}:${job.id}`,
            {
              jobId: job.id,
              queueName,
              result,
              status: "success",
            },
            { target: "global" },
          );

          return result;
        },
        {
          connection: this.redisConnection as unknown as ConnectionOptions,
          concurrency: config.maxIoConcurrency || 50,
        },
      );

      worker.on("failed", (job, err) => {
        this.logger.error(
          `[FastifyKit Queue] Error en tarea ${job?.id} de la cola ${queueName}:`,
          err,
        );

        // Emitimos evento global de error
        const eventBus = getEventBus();
        eventBus.emit(
          `job.done:${queueName}:${job?.id}`,
          {
            jobId: job?.id,
            queueName,
            error: err.message,
            status: "failed",
          },
          { target: "global" },
        );
      });

      this.workers.push(worker);
    }
  }

  /**
   * @description Cierra los workers y la conexión a Redis al detener la app.
   */
  public async beforeApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    if (this.redisConnection) {
      this.redisConnection.disconnect();
    }
  }
}
