/**
 * @description Token de inyección de dependencias para el adaptador de colas.
 * Cualquier motor de colas que se integre con FastifyKit debe ser registrado
 * en el contenedor de inyección de dependencias utilizando este token.
 */
export const QUEUE_ADAPTER_TOKEN = Symbol("QUEUE_ADAPTER");

/**
 * @description Interfaz que define como se debe comportar cualquier motor de colas que se integre con FastifyKit.
 * (Ejemplos de motores de colas podrían ser BullMQ, Workers locales, RabbitMQ, etc.).
 */
export interface QueueAdapter {
  /**
   * @description Método para enviar un trabajo a una cola específica.
   * @param queueName Nombre de la cola a la que se enviará el trabajo.
   * @param payload Datos asociados al trabajo que se deben procesar.
   * @returns Una promesa que resuelve con el identificador único del trabajo en la cola.
   */
  dispatch<T>(queueName: string, payload: T): Promise<string>;

  /**
   * @description Registra un nuevo procesador en el motor cuando el scanner del framework lo descubre
   * @param queueName Nombre de la cola para la que se debe registrar el procesador.
   */
  registerProcessor?(queueName: string): void;
}
