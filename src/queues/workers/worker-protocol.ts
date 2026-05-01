/**
 * Mensajes que el Pool envía al Worker para asignarle un nuevo trabajo o para su fase de inicialización
 */
export type WorkerIncomingMessage =
  | { type: "init"; bootstraps: string[] } // Fase de carga automática
  | ({ type: "job" } & WorkerIncomingJob); // Fase de trabajo

/**
 * Mensaje que el pool envia al hilo para asignarle un nuevo trabajo
 */
export interface WorkerIncomingJob {
  jobId: string;
  queueName: string;
  payload: unknown;
}

/**
 * Mensaje periodico del hilo hacia el pool para reportar su estado actual y ELU
 */
export interface WorkerHeartbeatMessage {
  type: "heartbeat";
  elu: number; // Event Loop Utilization (`performance.eventLoopUtilization().utilization`), ratio entre 0 y 1
}

/**
 * Mensaje del hilo hacia el pool para reportar que ha terminado un trabajo asignado, con su resultado o error
 */
export interface WorkerJobDoneMessage {
  type: "job_done";
  jobId: string;
  status: "success" | "error";
  data?: unknown;
  error?: string;
}

/**
 * Unión de los tipos de mensajes que el hilo puede enviar al pool
 */
export type WorkerOutgoingMessage =
  | WorkerHeartbeatMessage
  | WorkerJobDoneMessage
  | { type: "init_done" } // Mensaje del hilo hacia el pool para indicar que ha terminado de inicializarse
  | { type: "init_error"; error: string }; // Mensaje del hilo hacia el pool para indicar que ha ocurrido un error durante su inicialización
