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
  elu: number; // Expected Latency Until available (en milisegundos)
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
  | WorkerJobDoneMessage;
