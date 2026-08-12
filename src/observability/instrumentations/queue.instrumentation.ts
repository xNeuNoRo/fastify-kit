import type { DIContainer } from "../../container/DIContainer.js";
import type { TracerService } from "../contracts/TracerService.js";
import type { MetricsService } from "../contracts/MetricsService.js";
import {
  SEMATTR_MESSAGING_SYSTEM,
  SEMATTR_MESSAGING_OPERATION,
  SEMATTR_MESSAGING_DESTINATION,
  SEMATTR_MESSAGING_DESTINATION_KIND,
  SEMATTR_MESSAGING_MESSAGE_PAYLOAD_SIZE,
} from "../utils/semantic-conventions.js";
import {
  SEMVAL_MESSAGING_SYSTEM_IN_PROCESS,
  SEMVAL_MESSAGING_OPERATION_PUBLISH,
  SEMVAL_MESSAGING_DESTINATION_KIND_QUEUE,
} from "../utils/semantic-conventions.js";
import { SpanKind, SpanStatusCode } from "../contracts/TracerService.js";
import { QueueManager } from "../../queues/QueueManager.js";

/**
 * @description Instrumenta el QueueManager para crear spans de traza al despachar
 * trabajos a colas (dispatch). Inyecta el contexto de traza (W3C traceparent) en
 * el payload del job para que el worker pueda continuar la traza al procesarlo.
 *
 * Esto permite trazar el camino completo de un mensaje:
 * HTTP Request → Queue.publish → Worker.process → DB/Redis/External API
 *
 * Métricas registradas:
 * - queue_jobs_total{queue, status, adapter}
 *
 * Atributos semánticos:
 * - messaging.system: "in_process" (o "bullmq" según adapter)
 * - messaging.operation: "publish"
 * - messaging.destination: nombre de la cola
 * - messaging.destination_kind: "queue"
 * - messaging.message_payload_size: tamaño en bytes del payload
 *
 * @param container Contenedor DI para resolver QueueManager
 * @param tracer Servicio de trazas para crear spans PRODUCER
 * @param metrics Servicio de métricas para el contador de jobs
 */
export function instrumentQueueManager(
  container: DIContainer,
  tracer: TracerService,
  metrics: MetricsService,
): void {
  try {
    const queueManager = container.resolve(QueueManager);
    if (!queueManager || (queueManager as any).__otelPatched) return;

    const originalDispatch = queueManager.dispatch.bind(queueManager);

    /**
     * Wrapper que envuelve dispatch() para crear un span PRODUCER
     * e inyectar el contexto de traza en el payload del job.
     */
    queueManager.dispatch = async function <T>(
      queueName: string,
      payload: T,
    ): Promise<string> {
      const span = tracer.startSpan(`queue.publish ${queueName}`, {
        kind: SpanKind.PRODUCER,
        attributes: {
          [SEMATTR_MESSAGING_SYSTEM]: SEMVAL_MESSAGING_SYSTEM_IN_PROCESS,
          [SEMATTR_MESSAGING_OPERATION]: SEMVAL_MESSAGING_OPERATION_PUBLISH,
          [SEMATTR_MESSAGING_DESTINATION]: queueName,
          [SEMATTR_MESSAGING_DESTINATION_KIND]:
            SEMVAL_MESSAGING_DESTINATION_KIND_QUEUE,
          [SEMATTR_MESSAGING_MESSAGE_PAYLOAD_SIZE]:
            JSON.stringify(payload).length,
        },
      });

      // Inyectamos el contexto de traza en el payload para que el worker lo reciba
      const carrier: Record<string, string> = {};
      tracer.inject(carrier);

      const enrichedPayload = {
        ...(payload as any),
        __otel: carrier,
      };

      try {
        const jobId = await originalDispatch(queueName, enrichedPayload);

        metrics.increment("queue_jobs_total", {
          queue: queueName,
          status: "published",
          adapter: "in_process",
        });

        span.setStatus(SpanStatusCode.OK);
        return jobId;
      } catch (err) {
        metrics.increment("queue_jobs_total", {
          queue: queueName,
          status: "error",
          adapter: "in_process",
        });

        span.recordException(err as Error);
        throw err;
      } finally {
        span.end();
      }
    };

    (queueManager as any).__otelPatched = true;
  } catch {
    // QueueManager no disponible (no se configuró colas)
  }
}
