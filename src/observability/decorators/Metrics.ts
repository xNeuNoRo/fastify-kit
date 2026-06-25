import { METRICS_SERVICE_TOKEN } from "../contracts/MetricsService.js";
import { container } from "../../container/DIContainer.js";

type AllowedLabelValue = string | number | boolean;
type LabelRecord = Record<string, AllowedLabelValue>;

export interface MetricsOptions {
  counter?: string;
  histogram?: string;
  gauge?: string;
  labels?: LabelRecord;
  histogramBuckets?: number[];
}

export function Metrics(options: MetricsOptions) {
  const { counter, histogram, gauge, labels = {} } = options;

  return function <This, Args extends any[], Return>(
    target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >,
  ) {
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

export function validateMetricLabels(
  metricName: string,
  labels: Record<string, string>,
  allowedKeys: Set<string>,
): void {
  for (const key of Object.keys(labels)) {
    if (!allowedKeys.has(key)) {
      throw new Error(
        `[Metrics] Label key "${key}" not allowed for metric "${metricName}". ` +
          `Allowed: ${Array.from(allowedKeys).join(", ")}. ` +
          `Declare in @Metrics({ labels: { ${key}: "value" } })`,
      );
    }
  }
}
