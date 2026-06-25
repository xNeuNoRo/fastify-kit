/**
 * @description Token para inyectar el servicio de métricas (Prometheus)
 * en el contenedor de dependencias. Se resuelve en el ObservabilityBootstrapStep.
 *
 * @example
 * class ReportService {
 *   constructor(@Inject(METRICS_SERVICE_TOKEN) private metrics: MetricsService) {}
 *   async generateReport() {
 *     this.metrics.increment("reports_generated_total", { type: "monthly" });
 *   }
 * }
 */
export const METRICS_SERVICE_TOKEN = Symbol.for("METRICS_SERVICE_TOKEN");

/**
 * @description Contrato para el servicio de métricas (Prometheus).
 * Proporciona contadores, histogramas, gauges y summaries con soporte de
 * labels dimensionales y exemplars (enlace métrica → traza).
 *
 * Las métricas se exponen automáticamente en el endpoint /metrics
 * para que Prometheus las recolecte mediante scraping.
 *
 * Tipos de métricas soportadas:
 * - Counter: Solo incrementa (ej: total de peticiones, errores)
 * - Gauge: Sube y baja (ej: conexiones activas, memoria usada)
 * - Histogram: Distribución de valores (ej: latencia de peticiones)
 * - Summary: Cuantiles del lado del cliente (menos común que histogram)
 *
 * Se implementa en PromMetricsService usando prom-client.
 *
 * @example
 * class OrderService {
 *   constructor(@Inject(METRICS_SERVICE_TOKEN) private metrics: MetricsService) {}
 *
 *   async createOrder(order: OrderDto) {
 *     const start = performance.now();
 *     try {
 *       await this.repo.save(order);
 *       this.metrics.increment("orders_created_total", { status: "ok" });
 *       this.metrics.histogram("order_create_duration_seconds", (performance.now()-start)/1000);
 *     } catch (err) {
 *       this.metrics.increment("orders_created_total", { status: "error" });
 *       throw err;
 *     }
 *   }
 * }
 */
export interface MetricsService {
  /**
   * Incrementa un contador.
   * @param name Nombre de la métrica (ej: "http_requests_total")
   * @param labels Labels dimensionales (ej: { method: "POST", status: "200" })
   * @param value Valor a incrementar (por defecto 1)
   */
  increment(name: string, labels?: Record<string, string>, value?: number): void;

  /**
   * Decrementa un contador (solo aplicable a Gauges).
   * @param name Nombre de la métrica
   * @param labels Labels dimensionales
   * @param value Valor a decrementar (por defecto 1)
   */
  decrement(name: string, labels?: Record<string, string>, value?: number): void;

  /**
   * Establece un valor de gauge (medición instantánea).
   * @param name Nombre de la métrica (ej: "ws_connections_active")
   * @param value Valor actual del gauge
   * @param labels Labels dimensionales (ej: { room: "general" })
   */
  gauge(name: string, value: number, labels?: Record<string, string>): void;

  /**
   * Registra una observación en un histograma (distribución de valores).
   * @param name Nombre de la métrica (ej: "http_request_duration_seconds")
   * @param value Valor observado (ej: latencia en segundos)
   * @param labels Labels dimensionales (ej: { route: "/orders", status: "200" })
   */
  histogram(name: string, value: number, labels?: Record<string, string>): void;

  /**
   * Registra una observación en un summary (cuantiles del lado cliente).
   * @param name Nombre de la métrica
   * @param value Valor observado
   * @param labels Labels dimensionales
   */
  summary(name: string, value: number, labels?: Record<string, string>): void;

  /**
   * Registra las métricas por defecto del framework.
   * Incluye: http_requests_total, http_request_duration_seconds,
   * queue_jobs_total, queue_job_duration_seconds, redis_command_duration_seconds,
   * ws_connections_active, ws_messages_total, y métricas de proceso.
   */
  registerDefaultMetrics(): void;

  /**
   * Obtiene el contenido del endpoint /metrics en formato Prometheus.
   * @returns Texto en formato de exposición de Prometheus.
   */
  getMetricsEndpoint(): string;

  /**
   * Obtiene el Content-Type correcto para el endpoint de métricas.
   * @returns "text/plain; charset=utf-8" para Prometheus.
   */
  getContentType(): string;
}
