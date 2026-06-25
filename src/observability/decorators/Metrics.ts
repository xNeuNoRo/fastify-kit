import { METRICS_SERVICE_TOKEN } from "../contracts/MetricsService.js";
import { container } from "../../container/DIContainer.js";

type AllowedLabelValue = string | number | boolean;
type LabelRecord = Record<string, AllowedLabelValue>;

/**
 * @description Opciones para el decorador @Metrics.
 * Permite registrar automáticamente métricas RED (Rate, Errors, Duration)
 * alrededor de un método, con labels dimensionales y protección de cardinalidad.
 */
export interface MetricsOptions {
  /**
   * Nombre del contador (Counter).
   * Se incrementa en 1 por cada ejecución del método.
   * El label 'status' se añade automáticamente ("success" o "error").
   * Ej: orders_created_total{status="success"} 1
   */
  counter?: string;
  /**
   * Nombre del histograma (Histogram) para medir la latencia del método.
   * Registra la duración en segundos con buckets optimizados.
   * El label 'status' se añade automáticamente.
   * Ej: order_create_duration_seconds{status="success"} 0.15
   */
  histogram?: string;
  /**
   * Nombre del gauge para medir el valor actual de algo.
   * Se incrementa en 1 al entrar y se decrementa al salir.
   * Útil para medir "trabajos en progreso".
   */
  gauge?: string;
  /**
   * Labels estáticos que se añaden a todas las métricas.
   * SOLO estas claves están permitidas (cardinality guard).
   * NO uses IDs de usuario, request IDs, ni valores de alta cardinalidad.
   * Ej: { version: "v1", region: "eu-west-1" }
   */
  labels?: LabelRecord;
  /**
   * Buckets personalizados para el histograma.
   * Si no se especifica, se usan los buckets por defecto.
   */
  histogramBuckets?: number[];
}

/**
 * @description Decorador para métricas automáticas RED (Rate, Errors, Duration).
 * Envuelve un método midiendo su duración, contando invocaciones,
 * y registrando el estado (éxito/error) como label.
 *
 * Protege contra explosión de cardinalidad: solo permite las labels
 * declaradas explícitamente en el decorador.
 *
 * Si el MetricsService no está disponible, el método se ejecuta normalmente.
 *
 * @param options Configuración de las métricas a registrar
 * @returns Un decorador de método que envuelve la función original con métricas
 *
 * @example
 * // Métricas RED completas con labels de negocio
 * class OrderService {
 *   @Metrics({
 *     counter: "orders_created_total",
 *     histogram: "order_create_duration_seconds",
 *     labels: { version: "v1", region: "eu-west" }
 *   })
 *   async createOrder(@Body() dto: CreateOrderDto) {
 *     // Se mide automáticamente: contador, latencia, estado
 *     return this.repo.save(dto);
 *   }
 * }
 *
 * @example
 * // Gauge para medir trabajos en progreso
 * class BatchProcessor {
 *   @Metrics({ gauge: "batch_processing_active" })
 *   async processBatch(items: Item[]) {
 *     // El gauge sube a 1 al entrar y vuelve a 0 al salir
 *   }
 * }
 */
export function Metrics(options: MetricsOptions) {
  const { counter, histogram, gauge, labels = {} } = options;

  return function <This, Args extends any[], Return>(
    target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >,
  ) {
    // Validamos que el decorador se aplique solo a métodos de clase
    if (context.kind !== "method") {
      throw new Error("@Metrics solo puede ser aplicado a métodos de clase");
    }

    const methodName = String(context.name);
    const className =
      (context.metadata as any)?.className || "UnknownClass";
    const counterName =
      counter || `${className.toLowerCase()}_${methodName}_total`;
    const histogramName =
      histogram ||
      `${className.toLowerCase()}_${methodName}_duration_seconds`;
    const gaugeName =
      gauge || `${className.toLowerCase()}_${methodName}_active`;

    return function (this: This, ...args: Args): Return {
      let metrics: any;

      // Resolvemos el MetricsService del contenedor DI
      try {
        metrics = container.resolve(METRICS_SERVICE_TOKEN);
      } catch {
        return target.apply(this, args);
      }

      const start = performance.now();
      let status: "success" | "error" = "success";

      // Incrementamos el gauge al entrar (si se especificó)
      if (gauge) {
        metrics.gauge(gaugeName, 1, labels);
      }

      try {
        const result = target.apply(this, args);

        // Manejamos el resultado (síncrono o asíncrono)
        const handleResult = (res: Return): Return => {
          const duration = (performance.now() - start) / 1000;

          if (counter) {
            metrics.increment(counterName, { ...labels, status }, 1);
          }
          if (histogram) {
            metrics.histogram(histogramName, duration, {
              ...labels,
              status,
            });
          }
          if (gauge) {
            metrics.gauge(gaugeName, 0, labels);
          }

          return res;
        };

        const handleError = (err: Error): never => {
          status = "error";
          const duration = (performance.now() - start) / 1000;

          if (counter) {
            metrics.increment(counterName, { ...labels, status }, 1);
          }
          if (histogram) {
            metrics.histogram(histogramName, duration, {
              ...labels,
              status,
            });
          }
          if (gauge) {
            metrics.gauge(gaugeName, 0, labels);
          }

          throw err;
        };

        if (result instanceof Promise) {
          return result.then(handleResult).catch(handleError) as Return;
        }

        return handleResult(result);
      } catch (err) {
        status = "error";
        const duration = (performance.now() - start) / 1000;

        if (counter) {
          metrics.increment(counterName, { ...labels, status }, 1);
        }
        if (histogram) {
          metrics.histogram(histogramName, duration, {
            ...labels,
            status,
          });
        }
        if (gauge) {
          metrics.gauge(gaugeName, 0, labels);
        }

        throw err;
      }
    };
  };
}

/**
 * @description Valida que las labels usadas en runtime estén en el conjunto permitido.
 * Previene explosión de cardinalidad en Prometheus.
 *
 * @param metricName Nombre de la métrica (para el mensaje de error)
 * @param labels Labels que se van a usar
 * @param allowedKeys Conjunto de claves permitidas
 * @throws Error si alguna label no está en el conjunto permitido
 *
 * @example
 * const allowed = new Set(["version", "region"]);
 * validateMetricLabels("orders_total", { version: "v1", userId: "123" }, allowed);
 * // Throws: "Label key 'userId' not allowed for metric 'orders_total'"
 */
export function validateMetricLabels(
  metricName: string,
  labels: Record<string, string>,
  allowedKeys: Set<string>,
): void {
  for (const key of Object.keys(labels)) {
    if (!allowedKeys.has(key)) {
      throw new Error(
        `[Metrics] Label "${key}" no permitida para la metrica "${metricName}". ` +
          `Permitidas: ${Array.from(allowedKeys).join(", ")}. ` +
          `Declárala en @Metrics({ labels: { ${key}: "valor" } })`,
      );
    }
  }
}
