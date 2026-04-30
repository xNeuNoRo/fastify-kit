import { performance } from "node:perf_hooks";
import {
  WorkerHeartbeatMessage,
  WorkerIncomingMessage,
  WorkerJobDoneMessage,
} from "./worker-protocol.js";
import { parentPort } from "node:worker_threads";
import { QueueRegistry } from "../QueueRegistry.js";
import { container } from "../../container/DIContainer.js";
import type { JobHandler } from "../interfaces/JobHandler.js";

// Definimos el símbolo para la metadata de los procesadores,
// que usaremos para registrar los procesadores de cada cola en el Worker
const METADATA_SYMBOL =
  (Symbol as any).metadata ?? Symbol.for("Symbol.metadata");

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

// Variable para indicar si el worker ha terminado su fase de inicialización
let isReady = false;

/**
 * @description Función para registrar los procesadores de las colas en el Worker,
 * importando dinámicamente los archivos de procesadores descubiertos por el scanner del framework.
 * @param fileUrl La URL del archivo que contiene el procesador de la cola a registrar
 */
async function registerProcessorsFromFile(fileUrl: string) {
  const importedFile = await import(fileUrl);

  for (const key of Object.keys(importedFile)) {
    const exportedItem = importedFile[key as keyof typeof importedFile];

    // Si es una clase y tiene nuestra metadata
    if (typeof exportedItem === "function" && exportedItem[METADATA_SYMBOL]) {
      const metadata = exportedItem[METADATA_SYMBOL];

      if (metadata.queue) {
        // Lo registramos en el motor de colas del worker
        QueueRegistry.register(
          metadata.queue.name,
          exportedItem,
          metadata.queue.type,
        );
        // Lo inyectamos en el contenedor local del worker
        container.registerClass(exportedItem, exportedItem);
      }
    }
  }
}

/**
 * @description Función para manejar los mensajes de inicialización enviados por el pool al worker
 * durante la fase de bootstrapping, importando los archivos de procesadores y registrándolos en el worker.
 * @param message El mensaje de inicialización recibido del pool, que contiene la lista de archivos
 * de procesadores a importar y registrar en el worker
 */
async function handleInitMessage(
  message: Extract<WorkerIncomingMessage, { type: "init" }>,
) {
  try {
    // Para la fase de bootstrapping, importamos dinámicamente cada uno de los archivos de procesadores
    for (const fileUrl of message.bootstraps) {
      await registerProcessorsFromFile(fileUrl);
    }
    // Marcamos el worker como listo para recibir trabajos y se lo comunicamos al hilo principal
    isReady = true;
    parentPort?.postMessage({ type: "init_done" });
  } catch (error: unknown) {
    parentPort?.postMessage({
      type: "init_error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * @description Función para manejar los mensajes de trabajo enviados por el pool al worker,
 * buscando el procesador registrado para la cola correspondiente, ejecutando el trabajo
 * y enviando el resultado o error de vuelta al pool.
 * @param message El mensaje de trabajo recibido del pool, que contiene el jobId,
 * el nombre de la cola y el payload del trabajo a procesar
 * @returns Un Promise que se resuelve cuando el trabajo ha sido procesado y se ha enviado el resultado o error de vuelta al pool
 */
async function handleJobMessage(
  message: Extract<WorkerIncomingMessage, { type: "job" }>,
) {
  // Si el worker no ha terminado su inicialización,
  // no procesamos ningún trabajo entrante y esperamos a que termine de inicializarse
  if (!isReady) return;

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
    parentPort?.postMessage({
      type: "job_done",
      jobId: message.jobId,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Si hay un parentPort (basicamente, si estamos corriendo dentro de un Worker), configuramos un listener
// para manejar los mensajes entrantes con los trabajos asignados por el pool
if (parentPort) {
  parentPort.on("message", async (message: WorkerIncomingMessage) => {
    // Si el mensaje es de tipo "init", significa que el pool nos está enviando la fase de bootstrapping
    if (message.type === "init") {
      await handleInitMessage(message);
      return;
    }

    // Si el mensaje es de tipo "job", significa que el pool nos está asignando un nuevo trabajo para procesar
    if (message.type === "job") {
      await handleJobMessage(message);
    }
  });
}
