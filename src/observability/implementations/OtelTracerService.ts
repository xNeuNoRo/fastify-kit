import { Injectable } from "../../container/injectable.decorator.js";
import {
  SpanKind,
  SpanStatusCode,
  type Span,
  type SpanOptions,
  type SpanContext,
  type TracerService,
} from "../contracts/TracerService.js";
import type { LoggerContract } from "../../logger/LoggerContract.js";

let otelApi: any = null;
let otelSdk: any = null;
let otelResource: any = null;
let otelExporterOtlpGrpc: any = null;
let otelExporterOtlpHttp: any = null;
let otelExporterConsole: any = null;

async function loadOtel() {
  if (!otelApi) {
    otelApi = await import("@opentelemetry/api");
    otelSdk = await import("@opentelemetry/sdk-node");
    otelResource = await import("@opentelemetry/resources");
    otelExporterOtlpGrpc = await import(
      "@opentelemetry/exporter-trace-otlp-grpc"
    );
    otelExporterOtlpHttp = await import(
      "@opentelemetry/exporter-trace-otlp-http"
    );
    otelExporterConsole = await import("@opentelemetry/sdk-trace-base");
  }
}

class NoopSpan implements Span {
  spanId = "";
  traceId = "";
  name = "";

  setAttribute(_key: string, _value: string | number | boolean): void {}
  setAttributes(
    _attrs: Record<string, string | number | boolean>,
  ): void {}
  addEvent(
    _name: string,
    _attributes?: Record<string, string | number | boolean>,
  ): void {}
  recordException(_error: Error): void {}
  setStatus(_code: SpanStatusCode, _message?: string): void {}
  end(_endTime?: bigint): void {}
}

@Injectable()
export class OtelTracerService implements TracerService {
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private sdk: any = null;
  private tracer: any = null;
  private config: {
    enabled: boolean;
    sampler: string;
    ratio: number;
    exporter: string;
    otlpEndpoint?: string;
    otlpHeaders?: Record<string, string>;
  };

  constructor(
    config: {
      enabled: boolean;
      sampler: string;
      ratio: number;
      exporter: string;
      otlpEndpoint?: string;
      otlpHeaders?: Record<string, string>;
    },
    private logger: LoggerContract,
  ) {
    this.config = config;
    if (config.enabled) {
      this.initPromise = this.init();
    }
  }

  private async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      await loadOtel();

      const resource = new otelResource.Resource({
        [otelResource.SemanticResourceAttributes.SERVICE_NAME]:
          "fastify-kit",
        [otelResource.SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]:
          "development",
      });

      const sampler = this.createSampler();
      const exporter = this.createExporter();

      this.sdk = new otelSdk.NodeSDK({
        resource,
        sampler,
        spanProcessor: new (otelExporterConsole?.BatchSpanProcessor ||
          otelSdk.BatchSpanProcessor)(exporter),
      });

      await this.sdk.start();
      this.tracer = otelApi.trace.getTracer("fastify-kit", "1.0.0");

      this.logger.info("[OtelTracerService] OpenTelemetry SDK started", {
        sampler: this.config.sampler,
        exporter: this.config.exporter,
      });
    } catch (err) {
      this.logger.warn(
        "[OtelTracerService] Failed to initialize OpenTelemetry SDK, tracing disabled",
        { error: (err as Error).message },
      );
    }
  }

  private createSampler(): any {
    if (!otelSdk) return null;

    try {
      switch (this.config.sampler) {
        case "always_on":
          return otelSdk.AlwaysOnSampler;
        case "always_off":
          return otelSdk.AlwaysOffSampler;
        case "traceidratio":
          return otelSdk.TraceIdRatioBasedSampler(this.config.ratio || 0.1);
        case "parentbased_traceidratio":
        default:
          return otelSdk.ParentBasedSampler({
            root: otelSdk.TraceIdRatioBasedSampler(this.config.ratio || 0.1),
          });
      }
    } catch {
      return otelSdk.AlwaysOnSampler;
    }
  }

  private createExporter(): any {
    try {
      const endpoint = this.config.otlpEndpoint;

      switch (this.config.exporter) {
        case "otlp-grpc":
          if (otelExporterOtlpGrpc?.OTLPTraceExporter) {
            return new otelExporterOtlpGrpc.OTLPTraceExporter({
              url: endpoint,
              headers: this.config.otlpHeaders,
            });
          }
          break;
        case "otlp-http":
          if (otelExporterOtlpHttp?.OTLPTraceExporter) {
            return new otelExporterOtlpHttp.OTLPTraceExporter({
              url: endpoint,
              headers: this.config.otlpHeaders,
            });
          }
          break;
        case "console":
          if (otelExporterConsole?.ConsoleSpanExporter) {
            return new otelExporterConsole.ConsoleSpanExporter();
          }
          break;
        case "none":
        default:
          break;
      }
    } catch {
      // Fallback to console if available
    }

    if (otelExporterConsole?.ConsoleSpanExporter) {
      return new otelExporterConsole.ConsoleSpanExporter();
    }
    return { export: () => {}, shutdown: () => Promise.resolve() };
  }

  private getSpanContext(span: any): SpanContext {
    const ctx = span.spanContext();
    return {
      traceId: ctx.traceId,
      spanId: ctx.spanId,
      traceFlags: ctx.traceFlags,
      traceState: ctx.traceState?.serialize?.() || "",
    };
  }

  startSpan(name: string, options: SpanOptions = {}): Span {
    if (!this.tracer) return new NoopSpan();

    try {
      let parentCtx = otelApi.context.active();
      if (options.parentContext) {
        const spanCtx = new otelApi.SpanContext(
          options.parentContext.traceId,
          options.parentContext.spanId,
          options.parentContext.traceFlags ?? 1,
          options.parentContext.traceState,
        );
        parentCtx = otelApi.trace.setSpanContext(parentCtx, spanCtx);
      }

      const otelSpan = this.tracer.startSpan(name, {
        kind: options.kind ?? SpanKind.INTERNAL,
        attributes: options.attributes,
      }, parentCtx);

      return this.wrapSpan(otelSpan);
    } catch {
      return new NoopSpan();
    }
  }

  startActiveSpan<T>(
    name: string,
    fn: (span: Span) => T,
    options?: SpanOptions,
  ): T {
    const span = this.startSpan(name, options);
    try {
      return fn(span);
    } finally {
      this.endSpan(span);
    }
  }

  endSpan(span: Span): void {
    span.end();
  }

  inject(carrier: Record<string, string>): void {
    if (!otelApi) return;
    try {
      otelApi.propagation.inject(
        otelApi.context.active(),
        carrier,
      );
    } catch {
      // propagation not available
    }
  }

  extract(carrier: Record<string, string>): SpanContext | null {
    if (!otelApi) return null;
    try {
      const ctx = otelApi.propagation.extract(
        otelApi.context.active(),
        carrier,
      );
      const spanCtx = otelApi.trace.getSpanContext(ctx);
      if (spanCtx) {
        return {
          traceId: spanCtx.traceId,
          spanId: spanCtx.spanId,
          traceFlags: spanCtx.traceFlags,
          traceState: spanCtx.traceState,
        };
      }
    } catch {
      // extraction failed
    }
    return null;
  }

  getActiveSpan(): Span | undefined {
    if (!otelApi) return undefined;
    try {
      const otelSpan = otelApi.trace.getSpan(otelApi.context.active());
      if (otelSpan) return this.wrapSpan(otelSpan);
    } catch {
      // no active span
    }
    return undefined;
  }

  setBaggage(key: string, value: string): void {
    if (!otelApi) return;
    try {
      const ctx = otelApi.context.active();
      const baggage = otelApi.propagation.getBaggage(ctx) ||
        otelApi.propagation.createBaggage({});
      const newBaggage = baggage.setEntry(key, { value });
      otelApi.context.with(
        ctx.setValue(
          otelApi.propagation.BAGGAGE_CONTEXT_KEY || Symbol.for("OpenTelemetry Baggage Context Key"),
          newBaggage,
        ),
        () => {},
      );
    } catch {
      // baggage not available
    }
  }

  getBaggage(key: string): string | undefined {
    if (!otelApi) return undefined;
    try {
      const baggage = otelApi.propagation.getBaggage(
        otelApi.context.active(),
      );
      return baggage?.getEntry(key)?.value;
    } catch {
      return undefined;
    }
  }

  getAllBaggage(): Record<string, string> {
    if (!otelApi) return {};
    try {
      const baggage = otelApi.propagation.getBaggage(
        otelApi.context.active(),
      );
      if (!baggage) return {};
      const result: Record<string, string> = {};
      baggage.getAllEntries().forEach(
        ([key, entry]: [string, any]) => {
          result[key] = entry.value;
        },
      );
      return result;
    } catch {
      return {};
    }
  }

  clearBaggage(): void {
    if (!otelApi) return;
    try {
      const ctx = otelApi.context.active();
      const newBaggage = otelApi.propagation.createBaggage({});
      otelApi.context.with(
        ctx.setValue(
          otelApi.propagation.BAGGAGE_CONTEXT_KEY || Symbol.for("OpenTelemetry Baggage Context Key"),
          newBaggage,
        ),
        () => {},
      );
    } catch {
      // baggage not available
    }
  }

  isEnabled(): boolean {
    return this.config.enabled && !!this.tracer;
  }

  async shutdown(): Promise<void> {
    if (this.sdk) {
      try {
        await this.sdk.shutdown();
        this.logger?.info("[OtelTracerService] SDK shut down gracefully");
      } catch (err) {
        this.logger?.warn(
          "[OtelTracerService] Error shutting down SDK",
          { error: (err as Error).message },
        );
      }
    }
  }

  private wrapSpan(otelSpan: any): Span {
    const spanCtx = otelSpan.spanContext();
    return {
      spanId: spanCtx.spanId,
      traceId: spanCtx.traceId,
      name: otelSpan.name,
      setAttribute: (key, value) => otelSpan.setAttribute(key, value),
      setAttributes: (attrs) => {
        for (const [k, v] of Object.entries(attrs)) {
          otelSpan.setAttribute(k, v);
        }
      },
      addEvent: (name, attributes) =>
        otelSpan.addEvent(name, attributes),
      recordException: (error) => {
        otelSpan.recordException(error);
        otelSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
      },
      setStatus: (code, message) =>
        otelSpan.setStatus({ code, message }),
      end: (endTime?: bigint) => otelSpan.end(endTime),
    };
  }
}
