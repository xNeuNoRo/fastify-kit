import { randomUUID } from "node:crypto";
import type { QueueAdapter } from "../interfaces/QueueAdapter.js";
import { container } from "../../container/DIContainer.js";
import {
  QUEUE_REGISTRY_TOKEN,
  type QueueRegistryService,
} from "../QueueRegistryService.js";
import type { JobHandler } from "../interfaces/JobHandler.js";
import { Injectable } from "../../container/injectable.decorator.js";
import { getLogger } from "../../logger/logger.factory.js";

/**
 * @description Adaptador de colas simple que ejecuta las tareas en el mismo proceso, delegando la ejecución al Event Loop
 * para no bloquear la respuesta HTTP. Es ideal para casos de uso simples o durante el desarrollo,
 * pero no es recomendado para producción debido a que no ofrece aislamiento ni escalabilidad.
 */
@Injectable()
export class DefaultInProcessAdapter implements QueueAdapter {
  private readonly logger = getLogger();

  public async dispatch<T>(queueName: string, payload: T): Promise<string> {
    const trackingId = randomUUID();

    // Fire-and-Forget: Delegamos al Event Loop para que la respuesta HTTP siga su curso
    setImmediate(async () => {
      try {
        // Obtenemos la clase del procesador registrado para esta cola
        const queueRegistry = container.resolve<QueueRegistryService>(QUEUE_REGISTRY_TOKEN);
        const ProcessorClass = queueRegistry.getProcessor(queueName);

        // Si no hay un procesador registrado para esta cola, lanzamos un error
        if (!ProcessorClass) {
          throw new Error(
            `No hay procesador registrado para la cola '${queueName}'`,
          );
        }

        // Instanciamos el procesador usando el contenedor de dependencias para resolver sus dependencias
        const instance = container.resolve(ProcessorClass) as JobHandler;

        // Ejecutamos el handler del procesador con el payload.
        await instance.handle(trackingId, payload);
      } catch (error: unknown) {
        this.logger.error(
          `[FastifyKit InProcessQueue] Error procesando tarea en '${queueName}'`,
          error instanceof Error ? error : { error },
        );
      }
    });

    return trackingId;
  }
}
