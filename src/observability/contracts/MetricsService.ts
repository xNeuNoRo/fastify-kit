export const METRICS_SERVICE_TOKEN = Symbol.for("METRICS_SERVICE_TOKEN");

export interface MetricsService {
  increment(name: string, labels?: Record<string, string>, value?: number): void;
  decrement(name: string, labels?: Record<string, string>, value?: number): void;
  gauge(name: string, value: number, labels?: Record<string, string>): void;
  histogram(name: string, value: number, labels?: Record<string, string>): void;
  summary(name: string, value: number, labels?: Record<string, string>): void;
  registerDefaultMetrics(): void;
  getMetricsEndpoint(): string;
  getContentType(): string;
}
