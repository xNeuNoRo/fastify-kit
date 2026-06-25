import type { FastifyInstance } from "fastify";
import type { TracerService } from "../contracts/TracerService.js";
import type { MetricsService } from "../contracts/MetricsService.js";
import {
  SEMATTR_HTTP_METHOD,
  SEMATTR_HTTP_ROUTE,
  SEMATTR_HTTP_STATUS_CODE,
  SEMATTR_HTTP_SCHEME,
  SEMATTR_HTTP_HOST,
  SEMATTR_HTTP_TARGET,
  SEMATTR_HTTP_USER_AGENT,
  SEMATTR_HTTP_FLAVOR,
  SEMATTR_HTTP_RESPONSE_BODY_SIZE,
} from "../utils/semantic-conventions.js";
import { SpanKind, SpanStatusCode } from "../contracts/TracerService.js";
import {
  injectBaggage,
  parseBaggageHeader,
} from "../propagation/context-propagation.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Span de traza asociado a esta petición (inyectado por la instrumentación HTTP) */
    __otelSpan?: ReturnType<TracerService["startSpan"]>;
    /** Timestamp de inicio de la petición para calcular la duración */
    __startTime?: number;
  }
}

/**
 * @description Registra hooks de Fastify para instrumentación automática de peticiones HTTP.
 *
 * Hooks registrados:
 * - onRequest: Extrae traceparent/baggage de headers entrantes, crea span SERVER
 * - onResponse: Cierra el span, registra métricas RED (Rate, Errors, Duration)
 * - onError: Registra la excepción en el span y lo cierra
 *
 * Propagación W3C:
 * - Inyecta traceparent en headers de respuesta
 * - Inyecta baggage en headers de respuesta
 * - Extrae baggage entrante y lo establece en el tracer
 *
 * Atributos semánticos registrados:
 * - http.method, http.route, http.status_code, http.scheme, http.host, http.target
 * - http.user_agent, http.flavor, http.response.body.size
 *
 * Métricas automáticas:
 * - http_requests_total{method, route, status}
 * - http_request_duration_seconds{method, route, status} (con buckets optimizados)
 *
 * @param app Instancia de Fastify donde registrar los hooks
 * @param tracer Servicio de trazas para crear/extender spans
 * @param metrics Servicio de métricas para contadores e histogramas
 */
export function instrumentHttpServer(
  app: FastifyInstance,
  tracer: TracerService,
  metrics: MetricsService,
): void {
  /**
   * Hook onRequest: Se ejecuta ANTES de cualquier handler.
   * Crea el span SERVER raíz y extrae el contexto de traza entrante.
   */
  app.addHook("onRequest", async (request, reply) => {
    const traceparent = request.headers["traceparent"] as string | undefined;
    const baggageHeader = request.headers["baggage"] as string | undefined;

    // Extraemos el contexto de traza del servicio que nos llamó
    let parentContext = null;
    if (traceparent) {
      parentContext = tracer.extract({
        traceparent,
        baggage: baggageHeader || "",
      });
    }

    // Extraemos y establecemos el baggage (contexto de negocio: userId, tenantId...)
    if (baggageHeader) {
      const entries = parseBaggageHeader(baggageHeader);
      for (const [key, value] of Object.entries(entries)) {
        tracer.setBaggage(key, value);
      }
    }

    // Creamos el span SERVER para esta petición HTTP
    const route = request.routeOptions?.url || request.url;
    const span = tracer.startSpan(`${request.method} ${route}`, {
      kind: SpanKind.SERVER,
      parentContext: parentContext || undefined,
      attributes: {
        [SEMATTR_HTTP_METHOD]: request.method,
        [SEMATTR_HTTP_ROUTE]: request.routeOptions?.url || request.url,
        [SEMATTR_HTTP_SCHEME]: request.protocol,
        [SEMATTR_HTTP_HOST]: request.hostname,
        [SEMATTR_HTTP_TARGET]: request.url,
        [SEMATTR_HTTP_USER_AGENT]:
          (request.headers["user-agent"] as string) || "",
        [SEMATTR_HTTP_FLAVOR]: "1.1",
      },
    });

    // Guardamos el span y el timestamp en el request para los hooks posteriores
    (request as any).__otelSpan = span;
    (request as any).__startTime = performance.now();

    // Inyectamos traceparent en la respuesta para que el cliente pueda continuar la traza
    const headers: Record<string, string> = {};
    tracer.inject(headers);
    for (const [key, value] of Object.entries(headers)) {
      reply.header(key, value);
    }

    // Inyectamos baggage en la respuesta
    const baggageOut: Record<string, string> = {};
    injectBaggage(baggageOut, tracer);
    if (baggageOut.baggage) {
      reply.header("baggage", baggageOut.baggage);
    }
  });

  /**
   * Hook onResponse: Se ejecuta DESPUÉS de enviar la respuesta.
   * Cierra el span y registra las métricas RED.
   */
  app.addHook("onResponse", async (request, reply) => {
    const span = (request as any).__otelSpan;
    const startTime = (request as any).__startTime;

    if (span && startTime) {
      const duration = (performance.now() - startTime) / 1000;

      // Atributos finales del span
      span.setAttribute(SEMATTR_HTTP_STATUS_CODE, reply.statusCode);

      const contentLength = reply.getHeader("content-length");
      if (contentLength) {
        span.setAttribute(
          SEMATTR_HTTP_RESPONSE_BODY_SIZE,
          Number(contentLength),
        );
      }

      // Estado del span según código HTTP
      if (reply.statusCode >= 400) {
        span.setStatus(SpanStatusCode.ERROR, `HTTP ${reply.statusCode}`);
      } else {
        span.setStatus(SpanStatusCode.OK);
      }

      // Métricas RED (Rate, Errors, Duration)
      metrics.increment("http_requests_total", {
        method: request.method,
        route: request.routeOptions?.url || "unknown",
        status: String(reply.statusCode),
      });

      metrics.histogram("http_request_duration_seconds", duration, {
        method: request.method,
        route: request.routeOptions?.url || "unknown",
        status: String(reply.statusCode),
      });

      // Cerramos el span para enviarlo al exportador
      span.end();
    }
  });

  /**
   * Hook onError: Se ejecuta cuando ocurre un error no manejado.
   * Registra la excepción en el span para diagnóstico.
   */
  app.addHook("onError", async (request, _reply, error) => {
    const span = (request as any).__otelSpan;

    if (span) {
      span.recordException(error);
      span.setStatus(SpanStatusCode.ERROR, error.message);
      span.end();
    }
  });
}
