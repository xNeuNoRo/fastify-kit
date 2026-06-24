import { Injectable } from "../../container/injectable.decorator.js";
import type { MetricsService } from "../contracts/MetricsService.js";
import type { ObservabilityConfig } from "../contracts/ObservabilityConfig.js";
import type { TracerService } from "../contracts/TracerService.js";

let collectDefaultMetrics: any = null;
let Registry: any = null;
let Counter: any = null;
let Histogram: any = null;
let Gauge: any = null;

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

@Injectable()
export class PromMetricsService implements MetricsService {
  private register: any;
  private initialMetricsRegistered = false;
  private activeGauges = new Map<string, number>();

  constructor(
    config: { enabled: boolean; endpoint: string; defaultLabels: Record<string, string> },
    private tracer?: TracerService,
  ) {
    this.register = new (Registry || class {})();
    if (Registry) {
      this.register.setDefaultLabels({
        ...config.defaultLabels,
        service: "fastify-kit",
      });
    }
    this.init().catch(() => {});
  }

  private async init(): Promise<void> {
    try {
      await loadPromClient();
      this.register = new Registry();
      this.registerDefaultMetrics();
    } catch (err) {
      console.warn(
        "[PromMetricsService] Failed to initialize prom-client:",
        (err as Error).message,
      );
    }
  }

  registerDefaultMetrics(): void {
    if (this.initialMetricsRegistered) return;
    this.initialMetricsRegistered = true;

    try {
      if (collectDefaultMetrics) {
        collectDefaultMetrics({ register: this.register, prefix: "process_" });
      }
      if (!Counter || !Histogram || !Gauge) return;

      new Counter({
        name: "http_requests_total",
        help: "Total HTTP requests",
        labelNames: ["method", "route", "status"],
        registers: [this.register],
      });

      new Histogram({
        name: "http_request_duration_seconds",
        help: "HTTP request latency",
        labelNames: ["method", "route", "status"],
        buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
        registers: [this.register],
      });

      new Counter({
        name: "queue_jobs_total",
        help: "Total queue jobs processed",
        labelNames: ["queue", "status", "adapter"],
        registers: [this.register],
      });

      new Histogram({
        name: "queue_job_duration_seconds",
        help: "Queue job processing latency",
        labelNames: ["queue", "adapter"],
        buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60],
        registers: [this.register],
      });

      new Gauge({
        name: "queue_jobs_waiting",
        help: "Jobs waiting in queue",
        labelNames: ["queue", "adapter"],
        registers: [this.register],
      });

      new Histogram({
        name: "redis_command_duration_seconds",
        help: "Redis command latency",
        labelNames: ["command", "status"],
        buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
        registers: [this.register],
      });

      new Gauge({
        name: "ws_connections_active",
        help: "Active WebSocket connections",
        labelNames: ["gateway", "room"],
        registers: [this.register],
      });

      new Counter({
        name: "ws_messages_total",
        help: "Total WebSocket messages",
        labelNames: ["gateway", "type", "direction"],
        registers: [this.register],
      });
    } catch (err) {
      console.warn(
        "[PromMetricsService] Failed to register default metrics:",
        (err as Error).message,
      );
    }
  }

  private getExemplar(
    labels: Record<string, string>,
  ): { traceId: string } | undefined {
    try {
      const activeSpan = this.tracer?.getActiveSpan();
      if (activeSpan) return { traceId: activeSpan.traceId };
    } catch {
      // tracer not available
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
      // metric not found or data is already running in the background
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
      // metric not found or data is already running in the background
    }
  }

  gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    try {
      const metric = this.register?.getSingleMetric(name);
      if (metric && typeof metric.set === "function") {
        metric.set(labels, value);
      }
    } catch {
      // metric not found
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
      // metric not found
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
      // metric not found
    }
  }

  getMetricsEndpoint(): string {
    try {
      if (this.register && typeof this.register.metrics === "function") {
        return this.register.metrics();
      }
    } catch {
      // registry not available
    }
    return "# Metrics endpoint not available\n";
  }

  getContentType(): string {
    return "text/plain; charset=utf-8";
  }
}
