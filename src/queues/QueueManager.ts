import { Inject } from "../container/inject.decorator.js";
import { Injectable } from "../container/injectable.decorator.js";
import {
  QUEUE_ADAPTER_TOKEN,
  QueueAdapter,
} from "./interfaces/QueueAdapter.js";

@Injectable()
export class QueueManager {
  @Inject(QUEUE_ADAPTER_TOKEN)
  private readonly adapter!: QueueAdapter;

  /**
   * @description Método principal para despachar un trabajo a una cola específica utilizando el adaptador de colas configurado.
   * @param queueName El nombre de la cola a la que se enviará el trabajo
   * @param payload Los datos asociados al trabajo que se deben procesar
   * @returns Una promesa que resuelve con el identificador único del trabajo en la cola,
   * o se rechaza con un error si el envío del trabajo falla
   */
  public async dispatch<T = unknown>(
    queueName: string,
    payload: T,
  ): Promise<string> {
    if (!queueName) {
      throw new Error(
        "[FastifyKit QueueManager] El nombre de la cola es requerido para despachar un trabajo.",
      );
    }

    return await this.adapter.dispatch(queueName, payload);
  }
}
