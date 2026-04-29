/**
 * @description Interfaz que define la estructura de un JobHandler,
 * que es responsable de manejar trabajos en una cola. Debe tener un método handle
 * que recibe un jobId y un payload, y devuelve una promesa con el resultado del procesamiento del trabajo.
 */
export interface JobHandler<TPayload = unknown, TResult = unknown> {
  /**
   * @description Método que maneja el procesamiento de un trabajo en la cola.
   * @param jobId Identificador único del trabajo que se está procesando.
   * @param payload Datos asociados al trabajo que se deben procesar.
   * @returns Una promesa que resuelve con el resultado del procesamiento del trabajo.
   */
  handle(jobId: string, payload: TPayload): Promise<TResult>;
}
