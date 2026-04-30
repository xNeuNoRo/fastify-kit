import { randomUUID } from "node:crypto";
import type { QueueAdapter } from "../interfaces/QueueAdapter.js";
import { WorkerPool } from "../workers/WorkerPool.js";
import { getLogger } from "../../logger/logger.factory.js";
import { container } from "../../container/DIContainer.js";

export class LocalWorkerAdapter implements QueueAdapter {
  private readonly pool: WorkerPool;
  private readonly logger = getLogger();

  constructor() {
    // Resolvemos el WorkerPool desde el contenedor de inyección de dependencias
    // para asegurar que se comparta la misma instancia en toda la aplicación
    this.pool = container.resolve(WorkerPool);
  }

  public async dispatch<T>(queueName: string, payload: T): Promise<string> {
    // Generamos un ID único para el rastreo del worker
    const trackingId = randomUUID();

    // Preparamos el payload de la tarea, incluyendo el trackingId para que el worker pueda usarlo en los logs y rastreo.
    const taskPayload =
      typeof payload === "object" && payload !== null
        ? { ...payload, _trackingId: trackingId }
        : { data: payload, _trackingId: trackingId };

    // Fire-and-Forget: Lanzamos la tarea al motor multihilo sin bloquear el hilo principal
    this.pool.execute(queueName, taskPayload).catch((error) => {
      this.logger.error(
        `[FastifyKit QueueAdapter] Error procesando tarea en '${queueName}'`,
        error,
      );
    });

    // Retornamos el trackingId para que el dev pueda usarlo para rastrear la tarea en los logs
    return trackingId;
  }
}
