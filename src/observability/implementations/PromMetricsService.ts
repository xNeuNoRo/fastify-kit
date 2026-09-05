import { Injectable } from "../../container/injectable.decorator.js";
import type { MetricsService } from "../contracts/MetricsService.js";
import type { ObservabilityConfig } from "../contracts/ObservabilityConfig.js";
import type { TracerService } from "../contracts/TracerService.js";

/**
 * Variables para carga dinámica de prom-client.
 * Usamos import dinámico para que el servicio sea usable sin
 * que prom-client sea una dependencia obligatoria en runtime.
 */
let collectDefaultMetrics: any = null;
let Registry: any = null;
let Counter: any = null;
let Histogram: any = null;
let Gauge: any = null;

/**
 * Carga dinámica de prom-client. Solo se ejecuta la primera vez.
 * Inicializa las clases Registry, Counter, Histogram y Gauge.
 */
async function loadPromClient() {
  if (!Registry) {
    const mod = await import("prom-client");
    collectDefaultMetrics = mod.collectDefaultMetrics;
    Registry = mod.Registry;
    Counter = mod.Counter;
    Histogram = mod.Histogram;
    Gauge = mod.Gauge;
  }
}

/**
 * @description Implementación del MetricsService usando prom-client.
 * Gestiona métricas de Prometheus con soporte de exemplars (enlace
 * métrica → traza via tracer activo) y métricas por defecto del framework.
 *
 * Métricas registradas automáticamente:
 * - process_* (métricas de Node.js: CPU, memoria, event loop)
 * - http_requests_total + http_request_duration_seconds (RED HTTP)
 * - queue_jobs_total + queue_job_duration_seconds + queue_jobs_waiting
 * - redis_command_duration_seconds
 * - ws_connections_active + ws_messages_total
 *
 * Se instancia en ObservabilityBootstrapStep y se registra con METRICS_SERVICE_TOKEN.
 * El endpoint /metrics se auto-registra en Fastify via ObservabilityInstrumentationStep.
 *
 * @example
 * // El framework instancia esto automáticamente. En tus servicios, inyéctalo:
 * class ReportService {
 *   constructor(@Inject(METRICS_SERVICE_TOKEN) private metrics: MetricsService) {}
 *   async generate() {
 *     const start = performance.now();
 *     await this.repo.find();
 *     this.metrics.increment("reports_generated_total", { type: "monthly" });
 *     this.metrics.histogram("report_generation_seconds", (performance.now()-start)/1000);
 *   }
 * }
 */
@Injectable()
export class PromMetricsService implements MetricsService {
  private register: any;
  private initialMetricsRegistered = false;
  private activeGauges = new Map<string, number>();
  readonly ready: Promise<void>;

  constructor(
    private readonly config: {
      enabled: boolean;
      endpoint: string;
      defaultLabels?: Record<string, string>;
    },
    private tracer?: TracerService,
  ) {
    this.register = new (Registry || class {})();
    if (Registry) {
      this.register.setDefaultLabels({
        ...config.defaultLabels,
        service: "fastify-kit",
      });
    }
    this.ready = this.init();
  }

  /**
   * Inicialización asíncrona del registro de Prometheus.
   * Carga prom-client y registra las métricas por defecto del framework.
   */
  private async init(): Promise<void> {
    try {
      await loadPromClient();
      this.register = new Registry();
      this.register.setDefaultLabels({
        ...this.config.defaultLabels,
        service: "fastify-kit",
      });
      this.registerDefaultMetrics();
    } catch (err) {
      console.warn(
        "[PromMetricsService] Error inicializando prom-client:",
        (err as Error).message,
      );
    }
  }

  /**
   * Registra las métricas por defecto del framework en el Registry de Prometheus.
   * Incluye métricas de proceso (CPU, memoria), HTTP (RED), colas, Redis y WebSockets.
   * Solo se ejecuta una vez (idempotente via initialMetricsRegistered flag).
   */
  registerDefaultMetrics(): void {
    if (this.initialMetricsRegistered) return;
    this.initialMetricsRegistered = true;

    try {
      if (collectDefaultMetrics) {
        collectDefaultMetrics({ register: this.register, prefix: "process_" });
      }
      if (!Counter || !Histogram || !Gauge) return;

      new Counter({
        name: "cache_read_total",
        help: "Resultados de lecturas de caché",
        labelNames: ["result"],
        registers: [this.register],
      });
      new Histogram({
        name: "cache_loader_duration_seconds",
        help: "Duración de loaders de caché",
        registers: [this.register],
      });
      new Counter({
        name: "cache_lock_contention_total",
        help: "Contención de locks de caché",
        registers: [this.register],
      });
      new Counter({
        name: "cache_loader_error_total",
        help: "Errores de loaders de caché",
        registers: [this.register],
      });
      new Counter({
        name: "cache_invalidation_received_total",
        help: "Invalidaciones de caché recibidas",
        registers: [this.register],
      });
      new Counter({
        name: "cache_redis_operations_total",
        help: "Operaciones Redis de caché",
        labelNames: ["operation", "result"],
        registers: [this.register],
      });
      new Counter({
        name: "cache_fallback_total",
        help: "Fallbacks por degradación Redis",
        labelNames: ["policy"],
        registers: [this.register],
      });
      new Counter({
        name: "cache_load_shed_total",
        help: "Loaders rechazados por saturación",
        registers: [this.register],
      });
      new Gauge({
        name: "cache_redis_state",
        help: "Estado de disponibilidad Redis de caché",
        labelNames: ["state"],
        registers: [this.register],
      });

      // ===== Métricas HTTP (RED: Rate, Errors, Duration) =====

      new Counter({
        name: "http_requests_total",
        help: "Total de peticiones HTTP",
        labelNames: ["method", "route", "status"],
        registers: [this.register],
      });

      new Histogram({
        name: "http_request_duration_seconds",
        help: "Latencia de peticiones HTTP",
        labelNames: ["method", "route", "status"],
        buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
        registers: [this.register],
      });

      // ===== Métricas de Colas =====

      new Counter({
        name: "queue_jobs_total",
        help: "Total de trabajos procesados en colas",
        labelNames: ["queue", "status", "adapter"],
        registers: [this.register],
      });

      new Histogram({
        name: "queue_job_duration_seconds",
        help: "Latencia de procesamiento de trabajos de cola",
        labelNames: ["queue", "adapter"],
        buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60],
        registers: [this.register],
      });

      new Gauge({
        name: "queue_jobs_waiting",
        help: "Trabajos en espera en la cola",
        labelNames: ["queue", "adapter"],
        registers: [this.register],
      });

      // ===== Métricas Redis =====

      new Histogram({
        name: "redis_command_duration_seconds",
        help: "Latencia de comandos Redis",
        labelNames: ["command", "status"],
        buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
        registers: [this.register],
      });

      // ===== Métricas WebSocket =====

      new Gauge({
        name: "ws_connections_active",
        help: "Conexiones WebSocket activas",
        labelNames: ["gateway", "room"],
        registers: [this.register],
      });

      new Counter({
        name: "ws_messages_total",
        help: "Total de mensajes WebSocket",
        labelNames: ["gateway", "type", "direction"],
        registers: [this.register],
      });
    } catch (err) {
      console.warn(
        "[PromMetricsService] Error registrando metricas por defecto:",
        (err as Error).message,
      );
    }
  }

  /**
   * Obtiene el traceId del span activo para usarlo como exemplar en métricas.
   * Los exemplars permiten enlazar métricas con trazas: en Grafana,
   * al hacer click en un bucket del histograma, puedes ver el trace exacto
   * que causó esa observación.
   */
  private getExemplar(
    _labels: Record<string, string>,
  ): { traceId: string } | undefined {
    try {
      const activeSpan = this.tracer?.getActiveSpan();
      if (activeSpan) return { traceId: activeSpan.traceId };
    } catch {
      // Tracer no disponible
    }
    return undefined;
  }

  increment(
    name: string,
    labels: Record<string, string> = {},
    value = 1,
  ): void {
    try {
      const metric = this.register?.getSingleMetric(name);
      const exemplar = this.getExemplar(labels);
      if (metric && typeof metric.inc === "function") {
        metric.inc(labels, value, exemplar);
      }
    } catch {
      // Métrica no encontrada o prom-client no inicializado
    }
  }

  decrement(
    name: string,
    labels: Record<string, string> = {},
    value = 1,
  ): void {
    try {
      const metric = this.register?.getSingleMetric(name);
      if (metric && typeof metric.dec === "function") {
        metric.dec(labels, value);
      }
    } catch {
      // Métrica no encontrada o prom-client no inicializado
    }
  }

  gauge(
    name: string,
    value: number,
    labels: Record<string, string> = {},
  ): void {
    try {
      const metric = this.register?.getSingleMetric(name);
      if (metric && typeof metric.set === "function") {
        metric.set(labels, value);
      }
    } catch {
      // Métrica no encontrada
    }
  }

  histogram(
    name: string,
    value: number,
    labels: Record<string, string> = {},
  ): void {
    try {
      const metric = this.register?.getSingleMetric(name);
      const exemplar = this.getExemplar(labels);
      if (metric && typeof metric.observe === "function") {
        metric.observe(labels, value, exemplar);
      }
    } catch {
      // Métrica no encontrada
    }
  }

  summary(
    name: string,
    value: number,
    labels: Record<string, string> = {},
  ): void {
    try {
      const metric = this.register?.getSingleMetric(name);
      if (metric && typeof metric.observe === "function") {
        metric.observe(labels, value);
      }
    } catch {
      // Métrica no encontrada
    }
  }

  /**
   * Genera el contenido del endpoint /metrics en formato de exposición de Prometheus.
   * @returns Texto en formato Prometheus con todas las métricas registradas.
   */
  getMetricsEndpoint(): string {
    try {
      if (this.register && typeof this.register.metrics === "function") {
        const result = this.register.metrics();
        return typeof result === "string"
          ? result
          : "# Métricas cargando (registry listo en breve)\n";
      }
    } catch {
      // Registry no disponible
    }
    return "# Métricas no disponibles temporalmente\n";
  }

  async getMetricsEndpointAsync(): Promise<string> {
    await this.ready;
    if (!this.register || typeof this.register.metrics !== "function") {
      return "# Métricas no disponibles temporalmente\n";
    }
    const result = this.register.metrics();
    return await result;
  }

  getContentType(): string {
    return "text/plain; charset=utf-8";
  }
}
