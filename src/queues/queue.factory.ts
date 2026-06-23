import { container } from "../container/DIContainer.js";
import {
  QUEUE_ADAPTER_TOKEN,
  type QueueAdapter,
} from "./interfaces/QueueAdapter.js";
import { LocalWorkerAdapter } from "./adapters/LocalWorkerAdapter.js";
import {
  CONFIG_SERVICE_TOKEN,
  type ConfigService,
} from "../config/ConfigService.js";
import { DefaultInProcessAdapter } from "./adapters/DefaultInProcessAdapter.js";

/**
 * @description Factory para obtener el adaptador de colas activo.
 * Intenta resolverlo desde el contenedor (por si implementas un RedisAdapter u otro custom).
 * Si no hay ninguno, evalúa las opciones para decidir el mejor default.
 */
export async function getQueueAdapter(): Promise<QueueAdapter> {
  if (!container.has(QUEUE_ADAPTER_TOKEN)) {
    const configService = container.resolve<ConfigService>(CONFIG_SERVICE_TOKEN);
    const config = configService.get("queue") || {};

    if (config.strategy === "redis") {
      // Importación dinámica de BullMQAdapter para no forzar la dependencia de 'bullmq'
      // a menos que sea estrictamente necesario.
      const { BullMQAdapter } = await import("./adapters/BullMQAdapter.js");
      container.registerClass(QUEUE_ADAPTER_TOKEN, BullMQAdapter);
    } else if (config.strategy === "worker-pool") {
      container.registerClass(QUEUE_ADAPTER_TOKEN, LocalWorkerAdapter);
    } else {
      container.registerClass(QUEUE_ADAPTER_TOKEN, DefaultInProcessAdapter);
    }
  }

  return container.resolve<QueueAdapter>(QUEUE_ADAPTER_TOKEN);
}
