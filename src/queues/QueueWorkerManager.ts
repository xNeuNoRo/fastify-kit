import { ConnectionOptions, Worker } from "bullmq";
import { Redis } from "ioredis";
import { InternalConfig } from "../config/InternalConfig.js";
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
import { REDIS_CONNECTION_TOKEN } from "../distributed/redis.factory.js";

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
  private readonly logger = getLogger();

  public async onApplicationBootstrap(): Promise<void> {
    const config = InternalConfig.get("queue") || {};

    if (config.strategy !== "redis") return;

    // Obtenemos la conexión compartida centralizada
    const redisInstance = container.resolve<Redis>(REDIS_CONNECTION_TOKEN);
    const workerPool = container.resolve(WorkerPool);

    // Obtenemos todas las colas registradas por el scanner
    const registeredQueues = QueueRegistry.getRegisteredQueues();

    for (const queueName of registeredQueues) {
      const worker = new Worker(
        queueName,
        async (job) => {
          // Extraemos metadata interna si existe, manteniendo compatibilidad con payloads antiguos
          const rawData = job.data;
          const isFkPayload =
            rawData && typeof rawData === "object" && "_fk_metadata" in rawData;

          const payload = isFkPayload ? rawData.data : rawData;
          const sourceId = isFkPayload
            ? rawData._fk_metadata?.sourceId
            : "global";

          // Delegamos la ejecución al WorkerPool local (hilos paralelos) con los datos limpios
          const result = await workerPool.execute(queueName, payload);

          // Emitimos un evento dirigido al servidor de origen (o global si no se conoce)
          const eventBus = getEventBus();
          eventBus.emit(
            `queue.${queueName}.done.${job.id}`,
            {
              jobId: job.id,
              queueName,
              result,
              status: "success",
            },
            { target: sourceId },
          );

          return result;
        },
        {
          connection: redisInstance as unknown as ConnectionOptions,
          // Sincronizamos la concurrencia con la capacidad real del WorkerPool
          concurrency: config.maxIoConcurrency || 50,
        },
      );

      worker.on("failed", (job, err) => {
        this.logger.error(
          `[FastifyKit Queue] Error en tarea ${job?.id} de la cola ${queueName}:`,
          err,
        );

        // Extraemos sourceId para el fallo también
        const rawData = job?.data;
        const sourceId = rawData?._fk_metadata?.sourceId || "global";

        // Emitimos evento de error dirigido
        const eventBus = getEventBus();
        eventBus.emit(
          `queue.${queueName}.failed.${job?.id}`,
          {
            jobId: job?.id,
            queueName,
            error: err.message,
            status: "failed",
          },
          { target: sourceId },
        );
      });

      this.workers.push(worker);
    }
  }

  /**
   * @description Cierra los workers al detener la app.
   */
  public async beforeApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
  }
}
