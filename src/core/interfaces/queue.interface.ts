/**
 * @description Configuracion global para el motor de BackgroundJobs (Integrado en el framework)
 */
export type QueueOptions = {
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
