import { performance } from "node:perf_hooks";
import {
  WorkerHeartbeatMessage,
  WorkerIncomingJob,
  WorkerJobDoneMessage,
} from "./worker-protocol.js";
import { parentPort } from "node:worker_threads";
import { QueueRegistry } from "../QueueRegistry.js";
import { container } from "../../container/DIContainer.js";
import type { JobHandler } from "../interfaces/JobHandler.js";

// Variable para almacenar la última medición de ELU, inicializada al momento de cargar el módulo
let lastElu = performance.eventLoopUtilization();

// Configuramos un intervalo para medir el ELU cada segundo y
// enviar un mensaje de heartbeat al pool con el valor actualizado
setInterval(() => {
  const currentElu = performance.eventLoopUtilization(lastElu);
  lastElu = currentElu;

  const heartbeat: WorkerHeartbeatMessage = {
    type: "heartbeat",
    elu: currentElu.utilization,
  };

  parentPort?.postMessage(heartbeat);
}, 1000).unref(); // Usamos unref para permitir que el proceso se cierre si no hay otras tareas pendientes

// Si hay un parentPort (basicamente, si estamos corriendo dentro de un Worker), configuramos un listener
// para manejar los mensajes entrantes con los trabajos asignados por el pool
if (parentPort) {
  parentPort.on("message", async (message: WorkerIncomingJob) => {
    try {
      // Para cada trabajo entrante, buscamos el procesador registrado para la cola correspondiente
      const ProcessorClass = QueueRegistry.getProcessor(message.queueName);

      // Si no encontramos un procesador registrado para la cola, lanzamos un
      // error que será capturado y enviado de vuelta al pool
      if (!ProcessorClass) {
        throw new Error(
          `[FastifyKit Workers] No se encontró un procesador registrado para la cola: '${message.queueName}'`,
        );
      }

      // Creamos una instancia del procesador utilizando el contenedor de inyección de dependencias
      const instance = container.resolve(ProcessorClass);

      // Verificamos que la instancia creada implementa la interfaz JobHandler, es decir, que tiene un método handle
      const isValidHandler =
        instance &&
        typeof instance === "object" &&
        typeof (instance as Record<string, unknown>).handle === "function";

      if (!isValidHandler) {
        throw new Error(
          `[FastifyKit Workers] El procesador para la cola '${message.queueName}' no implementa la interfaz JobHandler`,
        );
      }

      const handler = instance as JobHandler;

      // Llamamos al método handle del procesador con el jobId y payload recibidos,
      // y esperamos su resultado para enviarlo de vuelta al pool
      const result = await handler.handle(message.jobId, message.payload);

      // Si el trabajo se procesa correctamente, enviamos un mensaje de éxito al pool con el resultado
      const successMsg: WorkerJobDoneMessage = {
        type: "job_done",
        jobId: message.jobId,
        status: "success",
        data: result,
      };
      parentPort?.postMessage(successMsg);
    } catch (error: unknown) {
      // Si ocurre cualquier error durante el procesamiento del trabajo,
      // capturamos el error y enviamos un mensaje de error al pool con los detalles del error
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      const failMsg: WorkerJobDoneMessage = {
        type: "job_done",
        jobId: message.jobId,
        status: "error",
        error: errorMessage,
      };

      parentPort?.postMessage(failMsg);
    }
  });
}
