import type { BootstrapContext, BootstrapStep } from "../../core/bootstrap/BootstrapPipeline.js";
import { container } from "../../container/DIContainer.js";
import { METRICS_SERVICE_TOKEN } from "../contracts/MetricsService.js";
import { TRACER_SERVICE_TOKEN } from "../contracts/TracerService.js";
import type { MetricsService } from "../contracts/MetricsService.js";
import type { TracerService } from "../contracts/TracerService.js";
import { instrumentHttpServer } from "../instrumentations/http.instrumentation.js";
import { instrumentRedisConnection } from "../instrumentations/redis.instrumentation.js";
import { instrumentQueueManager } from "../instrumentations/queue.instrumentation.js";
import { instrumentWsGatewayRegistry } from "../instrumentations/ws.instrumentation.js";
import { METRICS_ENDPOINT_TOKEN } from "./ObservabilityBootstrapStep.js";

/**
 * @description Paso de instrumentación automática del pipeline de bootstrap.
 * Se ejecuta después de CorePluginsStep (cuando la app Fastify ya tiene plugins)
 * y antes de LifecycleAndRoutesStep (antes de registrar rutas de usuario).
 *
 * Aplica monkey-patching ligero a los servicios del framework para añadir
 * spans de traza y métricas automáticas sin que el usuario tenga que
 * modificar su código.
 *
 * Instrumentaciones aplicadas según la configuración:
 * 1. HTTP: Registra hooks onRequest/onResponse/onError en Fastify
 * 2. /metrics: Monta el endpoint de Prometheus en la app Fastify
 * 3. Redis: Envuelve comandos ioredis con spans y métricas de latencia
 * 4. Colas: Envuelve QueueManager.dispatch con spans y trace context en payloads
 * 5. WebSockets: Envuelve WsMessageRouter.processIncomingMessage con spans
 *
 * Si el tracer está desactivado (tracing.enabled = false), no se aplica nada.
 */
export class ObservabilityInstrumentationStep implements BootstrapStep {
  readonly name = "ObservabilityInstrumentationStep";

  async execute(ctx: BootstrapContext): Promise<void> {
    let tracer: TracerService;
    let metrics: MetricsService;

    try {
      tracer = container.resolve<TracerService>(TRACER_SERVICE_TOKEN);
      metrics = container.resolve<MetricsService>(METRICS_SERVICE_TOKEN);
    } catch {
      return;
    }

    if (!tracer?.isEnabled?.()) {
      return;
    }

    // 1. Instrumentación HTTP: hooks onRequest/onResponse/onError en Fastify
    if (ctx.app) {
      instrumentHttpServer(ctx.app, tracer, metrics);
    }

    // 2. Registrar endpoint /metrics en Fastify (Prometheus scrape target)
    if (ctx.app && container.has(METRICS_ENDPOINT_TOKEN)) {
      const endpointInfo = container.resolve<{
        endpoint: string;
        getContent: () => string;
        getContentType: () => string;
      }>(METRICS_ENDPOINT_TOKEN);
      if (endpointInfo?.endpoint) {
        ctx.app.get(
          endpointInfo.endpoint,
          {
            schema: {
              tags: ["System"],
              summary: "Métricas de Prometheus",
              description:
                "Endpoint de métricas en formato Prometheus para scrape por el Prometheus Server.",
              response: {
                200: {
                  type: "string",
                  description: "Métricas en formato de exposición Prometheus",
                  contentMediaType: "text/plain; charset=utf-8",
                } as Record<string, unknown>,
              },
            },
          },
          async (_request, reply) => {
            reply
              .header("Content-Type", endpointInfo.getContentType())
              .send(endpointInfo.getContent());
          },
        );
      }
    }

    // 3. Instrumentación Redis: comandos ioredis con spans y métricas
    instrumentRedisConnection(container, tracer, metrics);

    // 4. Instrumentación Colas: QueueManager.dispatch con spans
    instrumentQueueManager(container, tracer, metrics);

    // 5. Instrumentación WebSockets: WsMessageRouter con spans
    instrumentWsGatewayRegistry(container, tracer, metrics);
  }
}
