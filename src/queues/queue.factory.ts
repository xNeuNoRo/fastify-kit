// src/queues/queue.factory.ts
import { container } from "../container/DIContainer.js";
import {
  QUEUE_ADAPTER_TOKEN,
  type QueueAdapter,
} from "./interfaces/QueueAdapter.js";
import { LocalWorkerAdapter } from "./adapters/LocalWorkerAdapter.js";
import { ConfigRegistry } from "../config/ConfigRegistry.js";
import type { QueueOptions } from "../core/interfaces/queue.interface.js";
import { DefaultInProcessAdapter } from "./adapters/DefaultInProcessAdapter.js";
import { getLogger } from "../logger/logger.factory.js";

/**
 * @description Factory para obtener el adaptador de colas activo.
 * Intenta resolverlo desde el contenedor (por si implementas un RedisAdapter u otro custom).
 * Si no hay ninguno, evalúa las opciones para decidir el mejor default.
 */
export function getQueueAdapter(): QueueAdapter {
  const logger = getLogger();

  if (!container.has(QUEUE_ADAPTER_TOKEN)) {
    const config = ConfigRegistry.get<QueueOptions>("queue_user_config") || {};

    if (config.strategy === "worker-pool") {
      logger.debug(
        "[FastifyKit Queues] Utilizando LocalWorkerAdapter (Multihilo) por defecto.",
      );
      container.registerClass(QUEUE_ADAPTER_TOKEN, LocalWorkerAdapter);
    } else {
      logger.debug(
        "[FastifyKit Queues] Utilizando DefaultInProcessAdapter por defecto (NO RECOMENDADO PARA CALCULOS INTENSIVOS, SOLO PARA I/O Y MVP).",
      );
      container.registerClass(QUEUE_ADAPTER_TOKEN, DefaultInProcessAdapter);
    }
  }

  return container.resolve<QueueAdapter>(QUEUE_ADAPTER_TOKEN);
}
