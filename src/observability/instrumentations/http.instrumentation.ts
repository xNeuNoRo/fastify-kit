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
    __otelSpan?: ReturnType<TracerService["startSpan"]>;
    __startTime?: number;
  }
}

export function instrumentHttpServer(
  app: FastifyInstance,
  tracer: TracerService,
  metrics: MetricsService,
): void {
  app.addHook("onRequest", async (request, reply) => {
    const traceparent = request.headers["traceparent"] as string | undefined;
    const baggageHeader = request.headers["baggage"] as string | undefined;

    let parentContext = null;
    if (traceparent) {
      parentContext = tracer.extract({
        traceparent,
        baggage: baggageHeader || "",
      });
    }

    if (baggageHeader) {
      const entries = parseBaggageHeader(baggageHeader);
      for (const [key, value] of Object.entries(entries)) {
        tracer.setBaggage(key, value);
      }
    }

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

    (request as any).__otelSpan = span;
    (request as any).__startTime = performance.now();

    const headers: Record<string, string> = {};
    tracer.inject(headers);
    for (const [key, value] of Object.entries(headers)) {
      reply.header(key, value);
    }

    const baggageOut: Record<string, string> = {};
    injectBaggage(baggageOut, tracer);
    if (baggageOut.baggage) {
      reply.header("baggage", baggageOut.baggage);
    }
  });

  app.addHook("onResponse", async (request, reply) => {
    const span = (request as any).__otelSpan;
    const startTime = (request as any).__startTime;

    if (span && startTime) {
      const duration = (performance.now() - startTime) / 1000;

      span.setAttribute(SEMATTR_HTTP_STATUS_CODE, reply.statusCode);

      const contentLength = reply.getHeader("content-length");
      if (contentLength) {
        span.setAttribute(
          SEMATTR_HTTP_RESPONSE_BODY_SIZE,
          Number(contentLength),
        );
      }

      if (reply.statusCode >= 400) {
        span.setStatus(SpanStatusCode.ERROR, `HTTP ${reply.statusCode}`);
      } else {
        span.setStatus(SpanStatusCode.OK);
      }

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

      span.end();
    }
  });

  app.addHook("onError", async (request, _reply, error) => {
    const span = (request as any).__otelSpan;

    if (span) {
      span.recordException(error);
      span.setStatus(SpanStatusCode.ERROR, error.message);
      span.end();
    }
  });
}
