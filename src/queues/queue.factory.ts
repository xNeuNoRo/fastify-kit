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

/**
 * @description Factory para obtener el adaptador de colas activo.
 * Intenta resolverlo desde el contenedor (por si implementas un RedisAdapter u otro custom).
 * Si no hay ninguno, evalúa las opciones para decidir el mejor default.
 */
export function getQueueAdapter(): QueueAdapter {
  if (!container.has(QUEUE_ADAPTER_TOKEN)) {
    const config = ConfigRegistry.get<QueueOptions>("queue_user_config") || {};

    if (config.strategy === "worker-pool") {
      container.registerClass(QUEUE_ADAPTER_TOKEN, LocalWorkerAdapter);
    } else {
      container.registerClass(QUEUE_ADAPTER_TOKEN, DefaultInProcessAdapter);
    }
  }

  return container.resolve<QueueAdapter>(QUEUE_ADAPTER_TOKEN);
}
