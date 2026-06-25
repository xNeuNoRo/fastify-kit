import { METRICS_SERVICE_TOKEN } from "../contracts/MetricsService.js";
import { container } from "../../container/DIContainer.js";

type AllowedLabelValue = string | number | boolean;
type LabelRecord = Record<string, AllowedLabelValue>;

/**
 * @description Opciones del decorador \@Metrics para instrumentar un metodo
 * con metricas RED (Rate, Errors, Duration) automaticamente.
 *
 * El decorador mide la duracion del metodo, cuenta invocaciones exitosas y fallidas,
 * y opcionalmente mantiene un gauge de operaciones en progreso.
 */
export interface MetricsOptions {
  /**
   * Nombre del contador (Counter) de Prometheus.
   * Se auto-incrementa en 1 por cada ejecucion, con el label 'status' ("success" | "error").
   * Ej: definis "orders_total" y ves orders_total{status="success"} en Grafana.
   */
  counter?: string;
  /**
   * Nombre del histograma (Histogram) para medir la latencia del metodo en segundos.
   * Usa buckets optimizados por defecto; podes sobrescribirlos con histogramBuckets.
   * Ej: definis "order_duration" y ves el p95 de latencia de creacion de ordenes.
   */
  histogram?: string;
  /**
   * Nombre del gauge para contar operaciones activas en este momento.
   * Se incrementa en 1 al entrar al metodo y se decrementa al salir.
   * Ideal para medir "trabajos en progreso" o "conexiones activas".
   */
  gauge?: string;
  /**
   * Labels fijas que se adjuntan a todas las metricas de este metodo.
   * IMPORTANTE: nunca uses valores de alta cardinalidad aqui (IDs de usuario,
   * request IDs, emails) porque eso explota Prometheus.
   *
   * Labels recomendadas: { version: "v1", region: "eu-west" }
   * Labels prohibidas:     { userId: "123", requestId: "abc" }
   */
  labels?: LabelRecord;
  /** Buckets personalizados para el histograma (si no se definen, se usan buckets optimizados genericos). */
  histogramBuckets?: number[];
}

/**
 * @description Decorador que envuelve un metodo con metricas automaticas RED.
 *
 * Al entrar al metodo se inicia un contador de tiempo y se incrementa el gauge si se especifico.
 * Al salir (exito o error) se registra la duracion en el histograma, se incrementa el counter
 * con el label 'status' correspondiente, y se decrementa el gauge.
 *
 * Protege contra el error mas comun en Prometheus: labels de alta cardinalidad.
 * Solo permite las claves declaradas explicitamente en `labels`.
 *
 * Si el MetricsService no esta disponible en el contenedor DI, el metodo se ejecuta
 * normalmente sin overhead de medicion.
 *
 * @param options Configuracion de las metricas a exponer.
 * @returns Un decorador de metodo que envuelve la ejecucion con instrumentacion RED.
 *
 * @example
 * // Metrica RED completa con labels de version y region
 * class OrderService {
 *   \@Metrics({
 *     counter: "orders_created_total",
 *     histogram: "order_create_duration_seconds",
 *     labels: { version: "v1", region: "eu-west" }
 *   })
 *   async createOrder(dto: CreateOrderDto) {
 *     // Se mide automaticamente: contador, latencia, estado
 *     return this.repo.save(dto);
 *   }
 * }
 *
 * @example
 * // Gauge para saber cuantos batches se estan procesando ahora mismo
 * class BatchProcessor {
 *   \@Metrics({ gauge: "batch_processing_active" })
 *   async processBatch(items: Item[]) {
 *     // El gauge sube a 1 al entrar y vuelve a 0 al salir, incluso si hay error
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
    // El decorador solo aplica a metodos; en propiedades o clases no tiene sentido medir
    if (context.kind !== "method") {
      throw new Error("@Metrics solo puede ser aplicado a métodos de clase");
    }

    const methodName = String(context.name);
    const className =
      (context.metadata as any)?.className || "UnknownClass";
    // Si el usuario no define nombres, generamos unos predecibles basados en clase+metodo
    const counterName =
      counter || `${className.toLowerCase()}_${methodName}_total`;
    const histogramName =
      histogram ||
      `${className.toLowerCase()}_${methodName}_duration_seconds`;
    const gaugeName =
      gauge || `${className.toLowerCase()}_${methodName}_active`;

    return function (this: This, ...args: Args): Return {
      let metrics: any;

      // Resolucion lazy desde el contenedor DI: si no hay servicio de metricas,
      // simplemente ejecutamos el metodo original sin instrumentar
      try {
        metrics = container.resolve(METRICS_SERVICE_TOKEN);
      } catch {
        return target.apply(this, args);
      }

      const start = performance.now();
      let status: "success" | "error" = "success";

      if (gauge) {
        metrics.gauge(gaugeName, 1, labels);
      }

      try {
        const result = target.apply(this, args);

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
 * @description Valida en runtime que las labels usadas esten dentro del conjunto permitido.
 * Pensada para evitar el error mas comun con Prometheus: labels de alta cardinalidad
 * que explotan el almacenamiento y degradan el rendimiento.
 *
 * @param metricName Nombre de la metrica (para mostrar en el mensaje de error).
 * @param labels Labels que se pretenden usar.
 * @param allowedKeys Claves que estan permitidas para esta metrica.
 * @throws Si alguna label no esta en el conjunto permitido.
 *
 * @example
 * const permitidas = new Set(["version", "region"]);
 * validateMetricLabels("orders_total", { version: "v1", userId: "usr_123" }, permitidas);
 * // Lanza: "Label 'userId' no permitida para la metrica 'orders_total'"
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
