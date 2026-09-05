import type { Redis } from "ioredis";
import { ConnectionOptions, Worker } from "bullmq";

import {
  INTERNAL_CONFIG_SERVICE_TOKEN,
  type InternalConfigService,
} from "../config/InternalConfigService.js";
import {
  QUEUE_REGISTRY_TOKEN,
  type QueueRegistryService,
} from "./QueueRegistryService.js";
import { WorkerPool } from "./workers/WorkerPool.js";
import { getLogger } from "../logger/logger.factory.js";
import { Injectable } from "../container/injectable.decorator.js";
import {
  OnApplicationBootstrap,
  BeforeApplicationShutdown,
} from "../core/interfaces/lifecycle.interface.js";
import { container } from "../container/DIContainer.js";
import { getEventBus } from "../events/eventbus.factory.js";
import { REDIS_CONNECTION_TOKEN } from "../distributed/redis.token.js";

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
  private closing?: Promise<void>;
  private started = false;

  public async onApplicationBootstrap(): Promise<void> {
    const internalConfig = container.resolve<InternalConfigService>(
      INTERNAL_CONFIG_SERVICE_TOKEN,
    );
    const config = internalConfig.get("queue") || {};

    if (config.strategy !== "redis") return;
    if (this.started) return;

    const eventBus = getEventBus();
    const waitUntilReady = (
      eventBus as typeof eventBus & { waitUntilReady?: () => Promise<void> }
    ).waitUntilReady;
    if (waitUntilReady) await waitUntilReady.call(eventBus);
    this.started = true;

    // Obtenemos la conexión compartida centralizada
    const redisInstance = container.resolve<Redis>(REDIS_CONNECTION_TOKEN);
    const workerPool = container.resolve(WorkerPool);

    // Obtenemos todas las colas registradas por el scanner
    const queueRegistry =
      container.resolve<QueueRegistryService>(QUEUE_REGISTRY_TOKEN);
    const registeredQueues = queueRegistry.getRegisteredQueues();

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
          eventBus.emit(
            `queue.${queueName}.done.${job.id}`,
            {
              jobId: job.id,
              queueName,
              result,
              status: "success",
              data: payload,
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

        // Extraemos sourceId y data para el fallo también
        const rawData = job?.data;
        const isFkPayload =
          rawData && typeof rawData === "object" && "_fk_metadata" in rawData;

        const payload = isFkPayload ? rawData.data : rawData;
        const sourceId = isFkPayload
          ? rawData._fk_metadata?.sourceId
          : "global";

        // Emitimos evento de error dirigido
        eventBus.emit(
          `queue.${queueName}.failed.${job?.id}`,
          {
            jobId: job?.id,
            queueName,
            error: err.message,
            status: "failed",
            data: payload,
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
    if (this.closing) return this.closing;
    this.closing = (async () => {
      const workers = this.workers.splice(0);
      await Promise.allSettled(workers.map((worker) => worker.close()));
    })();
    return this.closing;
  }
}
