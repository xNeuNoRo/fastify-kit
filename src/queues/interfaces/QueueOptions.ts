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

/**
 * @description Configuracion global para el motor de BackgroundJobs (Integrado en el framework)
 */
export type QueueModuleOptions = {
  /**
   * Tamaño del pool de hilos. Por defecto: nucleos logicos del sistema - 1 (-1 para dejar un hilo para la API principal)
   */
  poolSize?: number;
  /**
   * Limite de tareas concurrentes por hilo para tareas I/O.
   * @default 50
   */
  maxIoConcurrency?: number;
  /**
   * Umbral de saturacion del Event Loop para tareas CPU (0.0 a 1.0)
   * @default 0.85
   */
  eluThreshold?: number;
};
