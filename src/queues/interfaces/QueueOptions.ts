/**
 * @description Perfil de la cola, que indica el tipo de tareas que se procesarán en ella.
 * Esto ayuda a optimizar el rendimiento y la asignación de recursos.
 */
export type QueueType = "cpu" | "io";

/**
 * @description Configuracion especifica para procesador (metadata de la clase que se encargará de procesar las tareas de la cola)
 */
export interface QueueProcessorMetadata {
  name: string;
  type: QueueType;
}
