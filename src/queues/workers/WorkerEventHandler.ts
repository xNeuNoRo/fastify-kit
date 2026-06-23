import { Worker } from "node:worker_threads";
import { getLogger } from "../../logger/logger.factory.js";
import type { WorkerNode } from "./WorkerLifecycleManager.js";

/**
 * @description Manejador de eventos de error y salida de workers.
 * Escucha los eventos error/exit de cada worker y delega al LifecycleManager
 * para la limpieza y reemplazo del worker colapsado.
 *
 * Es stateless: no mantiene estado propio, solo enruta eventos.
 */
export class WorkerEventHandler {
  private readonly logger = getLogger();

  /**
   * @description Manejamos errores del worker para detectar colapsos y reemplazarlo.
   */
  handleError(
    err: Error,
    workerNode: WorkerNode,
    worker: Worker,
    onDeadWorker: (reason: string) => void,
  ): void {
    this.logger.error(
      "[FastifyKit Background Jobs] El hilo de un worker ha colapsado",
      err,
    );
    onDeadWorker(err.message);
  }

  /**
   * @description Manejamos la salida inesperada del worker para detectar colapsos y reemplazarlo.
   */
  handleExit(
    code: number,
    workerNode: WorkerNode,
    worker: Worker,
    onDeadWorker: (reason: string) => void,
  ): void {
    if (code !== 0) {
      this.logger.error(
        `[FastifyKit Background Jobs] Un worker se cerró inesperadamente con código ${code}`,
      );
      onDeadWorker(`Exit code ${code}`);
    }
  }
}
