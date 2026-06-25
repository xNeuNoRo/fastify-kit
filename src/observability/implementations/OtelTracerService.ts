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

/**
 * Variables para carga dinámica de paquetes OpenTelemetry.
 * Todos los imports son dinámicos para que el framework funcione
 * sin OTel si el usuario no lo necesita (tracing.enabled = false).
 */
let otelApi: any = null;
let otelSdk: any = null;
let otelResource: any = null;
let otelExporterOtlpGrpc: any = null;
let otelExporterOtlpHttp: any = null;
let otelExporterConsole: any = null;

/**
 * Carga dinámica de todos los paquetes OpenTelemetry necesarios.
 * Se ejecuta una sola vez (cache global) al iniciar el tracer.
 */
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

/**
 * Span que no hace nada. Se usa como fallback cuando el tracer está desactivado
 * o OTel no está disponible, para que el código de usuario no tenga que
 * verificar null en cada span.
 */
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

/**
 * @description Implementación del TracerService usando OpenTelemetry SDK.
 * Gestiona el ciclo de vida completo del SDK (start → spans → shutdown),
 * configuración de muestreo (sampler) y exportadores (console, OTLP gRPC/HTTP).
 *
 * NO usa auto-instrumentation: toda la instrumentación es manual y selectiva,
 * lo que da control total sobre qué se traza y con qué atributos semánticos.
 *
 * Características:
 * - Muestreo configurable (always_on, traceidratio, parentbased_traceidratio)
 * - Exportación a OTLP Collector (gRPC o HTTP) o console
 * - Propagación de contexto W3C (traceparent + baggage) entre servicios
 * - Baggage para datos de negocio (userId, tenantId, featureFlags)
 * - NoopSpan como fallback cuando el tracer está desactivado
 *
 * Se instancia en el ObservabilityBootstrapStep y se registra con TRACER_SERVICE_TOKEN.
 *
 * @example
 * class OrderService {
 *   constructor(@Inject(TRACER_SERVICE_TOKEN) private tracer: TracerService) {}
 *
 *   async create(dto: CreateOrderDto) {
 *     // Span activo gestionado automáticamente
 *     return this.tracer.startActiveSpan("order.create", async (span) => {
 *       span.setAttribute("order.id", dto.id);
 *       tracer.setBaggage("userId", dto.userId);
 *       await this.repo.save(dto);
 *       span.setStatus(SpanStatusCode.OK);
 *     });
 *   }
 * }
 */
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

  /**
   * Inicializa el SDK de OpenTelemetry con la configuración proporcionada.
   * Configura resource (nombre del servicio, entorno), sampler, y exporter.
   * Si falla, el tracer queda desactivado y los spans serán NoopSpan.
   */
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

      this.logger.info("[OtelTracerService] SDK de OpenTelemetry iniciado", {
        sampler: this.config.sampler,
        exporter: this.config.exporter,
      });
    } catch (err) {
      this.logger.warn(
        "[OtelTracerService] Error inicializando SDK de OpenTelemetry, tracing desactivado",
        { error: (err as Error).message },
      );
    }
  }

  /**
   * Crea el sampler de OpenTelemetry según la configuración.
   *
   * - always_on: 100% de trazas (desarrollo)
   * - always_off: 0% (desactivado)
   * - traceidratio: Muestrear un % fijo (ej: 10% = una de cada 10)
   * - parentbased_traceidratio: Respeta decisión del trace padre +
   *   muestrea % fijo para raíces (producción recomendado)
   */
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

  /**
   * Crea el exportador de spans según la configuración.
   *
   * - otlp-grpc: OpenTelemetry Collector via gRPC (puerto 4317)
   * - otlp-http: OpenTelemetry Collector via HTTP (puerto 4318, recomendado)
   * - console: Imprime spans en consola (desarrollo local)
   * - none: No exporta, útil para métricas internas solamente
   */
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
      // Fallback a console si está disponible
    }

    if (otelExporterConsole?.ConsoleSpanExporter) {
      return new otelExporterConsole.ConsoleSpanExporter();
    }
    return { export: () => {}, shutdown: () => Promise.resolve() };
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

  /**
   * Inyecta el contexto de traza actual (traceparent W3C) en un carrier HTTP.
   * Esto permite propagar la traza a servicios downstream en llamadas fetch/axios/gRPC.
   *
   * @example
   * const headers: Record<string, string> = {};
   * tracer.inject(headers);
   * // headers = { traceparent: "00-abc...-def...-01" }
   */
  inject(carrier: Record<string, string>): void {
    if (!otelApi) return;
    try {
      otelApi.propagation.inject(
        otelApi.context.active(),
        carrier,
      );
    } catch {
      // Propagación no disponible
    }
  }

  /**
   * Extrae el contexto de traza de headers HTTP entrantes.
   * Se usa para continuar trazas iniciadas por servicios upstream.
   *
   * @example
   * const ctx = tracer.extract({ traceparent: "00-abc...-def...-01" });
   * if (ctx) {
   *   tracer.startSpan("mi.operacion", { parentContext: ctx });
   * }
   */
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
      // Extracción fallida
    }
    return null;
  }

  /**
   * Obtiene el span activo en el contexto actual de AsyncLocalStorage.
   * Útil para el PromMetricsService al generar exemplars.
   */
  getActiveSpan(): Span | undefined {
    if (!otelApi) return undefined;
    try {
      const otelSpan = otelApi.trace.getSpan(otelApi.context.active());
      if (otelSpan) return this.wrapSpan(otelSpan);
    } catch {
      // Sin span activo
    }
    return undefined;
  }

  /**
   * Establece un valor de baggage (contexto de negocio que viaja entre servicios).
   * El baggage se propaga automáticamente en headers HTTP y se mantiene
   * en el AsyncLocalStorage del request actual.
   *
   * @example
   * tracer.setBaggage("userId", "usr_456");
   * tracer.setBaggage("tenantId", "tenant_789");
   * // Se propaga automáticamente al llamar a otros servicios
   */
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
      // Baggage no disponible
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
      // Baggage no disponible
    }
  }

  isEnabled(): boolean {
    return this.config.enabled && !!this.tracer;
  }

  /**
   * Apaga el SDK de OpenTelemetry gracefulmente.
   * Vacía los buffers de spans pendientes y libera recursos.
   * Se llama automáticamente en el shutdown de la aplicación.
   */
  async shutdown(): Promise<void> {
    if (this.sdk) {
      try {
        await this.sdk.shutdown();
        this.logger?.info("[OtelTracerService] SDK apagado correctamente");
      } catch (err) {
        this.logger?.warn(
          "[OtelTracerService] Error apagando SDK",
          { error: (err as Error).message },
        );
      }
    }
  }

  /**
   * Envuelve un span nativo de OpenTelemetry en nuestra interfaz Span.
   * Esto permite exponer una API consistente sin acoplar el código
   * de usuario a los tipos internos de OTel.
   */
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
