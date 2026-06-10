/**
 * @description Interfaz que define el payload estándar para los eventos de colas.
 * Permite al desarrollador tener un tipado fuerte al escuchar el resultado de una tarea.
 * @template TResult El tipo de dato retornado por el procesador de la cola.
 * @template TData El tipo de dato que se envió originalmente a la cola.
 */
export interface QueueJobEvent<TResult = any, TData = any> {
  /** Identificador único de la tarea generado por el motor de colas */
  jobId: string;
  /** Nombre de la cola que procesó la tarea */
  queueName: string;
  /** Estado final de la ejecución */
  status: "success" | "failed";
  /** El resultado devuelto por el método handle del procesador (solo en success) */
  result?: TResult;
  /** El mensaje de error en caso de que la ejecución haya fallado (solo en failed) */
  error?: string;
  /** Los datos originales que fueron enviados al despachar la tarea */
  data: TData;
}

/**
 * @description Utilidad para generar los nombres de eventos de colas siguiendo la nomenclatura del Árbol Trie de FastifyKit.
 * Útil para suscripciones manuales vía EventBus.
 */
export const QueueEvents = {
  /** Genera el patrón para escuchar éxitos: 'queue.<name>.done.*' */
  done: (queueName: string) => `queue.${queueName}.done.*`,
  /** Genera el patrón para escuchar fallos: 'queue.<name>.failed.*' */
  failed: (queueName: string) => `queue.${queueName}.failed.*`,
};
