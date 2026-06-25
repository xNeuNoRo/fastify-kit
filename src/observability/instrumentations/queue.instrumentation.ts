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

export function instrumentQueueManager(
  container: DIContainer,
  tracer: TracerService,
  metrics: MetricsService,
): void {
  try {
    const queueManager = container.resolve(QueueManager);
    if (!queueManager || (queueManager as any).__otelPatched) return;

    const originalDispatch = queueManager.dispatch.bind(queueManager);

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
    // QueueManager not available
  }
}
