import type { BootstrapContext, BootstrapStep } from "../../core/bootstrap/BootstrapPipeline.js";
import { container } from "../../container/DIContainer.js";
import { LOGGER_TOKEN } from "../../logger/LoggerContract.js";
import { METRICS_SERVICE_TOKEN } from "../contracts/MetricsService.js";
import { TRACER_SERVICE_TOKEN } from "../contracts/TracerService.js";
import type { MetricsService } from "../contracts/MetricsService.js";
import type { TracerService } from "../contracts/TracerService.js";
import { instrumentHttpServer } from "../instrumentations/http.instrumentation.js";
import { instrumentRedisConnection } from "../instrumentations/redis.instrumentation.js";
import { instrumentQueueManager } from "../instrumentations/queue.instrumentation.js";
import { instrumentWsGatewayRegistry } from "../instrumentations/ws.instrumentation.js";

export class ObservabilityInstrumentationStep implements BootstrapStep {
  readonly name = "ObservabilityInstrumentationStep";

  async execute(ctx: BootstrapContext): Promise<void> {
    const logger = container.resolve<any>(LOGGER_TOKEN);
    let tracer: TracerService;
    let metrics: MetricsService;

    try {
      tracer = container.resolve<TracerService>(TRACER_SERVICE_TOKEN);
      metrics = container.resolve<MetricsService>(METRICS_SERVICE_TOKEN);
    } catch {
      logger?.warn?.(
        "[ObservabilityInstrumentationStep] No observability services found, skipping instrumentation",
      );
      return;
    }

    if (!tracer?.isEnabled?.()) {
      return;
    }

    // HTTP instrumentation (Fastify hooks)
    if (ctx.app) {
      instrumentHttpServer(ctx.app, tracer, metrics);
    }

    // Redis instrumentation
    instrumentRedisConnection(container, tracer, metrics);

    // Queue instrumentation
    instrumentQueueManager(container, tracer, metrics);

    // WebSocket instrumentation
    instrumentWsGatewayRegistry(container, tracer, metrics);
  }
}
