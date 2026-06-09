/**
 * @description Configuracion global para el motor de BackgroundJobs (Integrado en el framework)
 */
export type QueueOptions = {
  /**
   * Estrategia de ejecución del motor de colas.
   * - 'in-process': Ejecuta en el mismo hilo usando el Event Loop (Zero-config, ideal para I/O y MVP).
   * - 'worker-pool': Utiliza Worker Threads aislados para cálculos intensivos sin bloquear tu API.
   * - 'redis': Utiliza Redis y BullMQ para colas distribuidas entre múltiples instancias.
   * @default 'in-process'
   */
  strategy?: "in-process" | "worker-pool" | "redis";
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
