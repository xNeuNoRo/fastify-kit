import { randomUUID } from "node:crypto";
import type { QueueAdapter } from "../interfaces/QueueAdapter.js";
import { WorkerPool } from "../workers/WorkerPool.js";
import { getLogger } from "../../logger/logger.factory.js";

export class LocalWorkerAdapter implements QueueAdapter {
  private readonly pool: WorkerPool;
  private readonly logger = getLogger();

  constructor() {
    // El pool ya se auto-configura leyendo el ConfigRegistry
    this.pool = new WorkerPool();
  }

  public async dispatch<T>(queueName: string, payload: T): Promise<string> {
    // Generamos un ID único para el rastreo del worker
    const trackingId = randomUUID();

    // Fire-and-Forget: Lanzamos la tarea al motor multihilo sin bloquear el hilo principal
    // Agregamos el trackingId al payload para que el worker pueda incluirlo en los logs y facilitar el rastreo de la tarea
    this.pool
      .execute(queueName, { _trackingId: trackingId, ...payload })
      .catch((error) => {
        this.logger.error(
          `[FastifyKit QueueAdapter] Error procesando tarea en '${queueName}'`,
          error,
        );
      });

    // Retornamos el trackingId para que el dev pueda usarlo para rastrear la tarea en los logs
    return trackingId;
  }
}
