import { Injectable } from "../../container/injectable.decorator.js";
import { Inject } from "../../container/inject.decorator.js";
import { METRICS_SERVICE_TOKEN, type MetricsService } from "../../observability/contracts/MetricsService.js";
import { TRACER_SERVICE_TOKEN, type TracerService } from "../../observability/contracts/TracerService.js";
import { LOGGER_TOKEN, type LoggerContract } from "../../logger/LoggerContract.js";
import { HealthIndicator } from "./HealthIndicator.js";
import type { HealthIndicatorResult } from "../interfaces.js";

@Injectable()
export class ObservabilityHealthIndicator extends HealthIndicator {
  @Inject(METRICS_SERVICE_TOKEN)
  private readonly metrics!: MetricsService;

  @Inject(TRACER_SERVICE_TOKEN)
  private readonly tracer!: TracerService;

  @Inject(LOGGER_TOKEN)
  private readonly logger!: LoggerContract;

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const checks: Record<string, () => Promise<{ status: string; details?: any }>> = {
      metrics: async () => {
        try {
          const endpoint = this.metrics.getMetricsEndpoint();
          return endpoint
            ? { status: "up", details: { available: true } }
            : { status: "down", details: { error: "no metrics data" } };
        } catch (err) {
          return { status: "down", details: { error: (err as Error).message } };
        }
      },
      tracer: async () => {
        try {
          return this.tracer.isEnabled()
            ? { status: "up", details: { initialized: true } }
            : { status: "down", details: { error: "tracer disabled" } };
        } catch (err) {
          return { status: "down", details: { error: (err as Error).message } };
        }
      },
    };

    const details: Record<string, any> = {};
    let hasErrors = false;

    for (const [name, check] of Object.entries(checks)) {
      try {
        const result = await check();
        details[name] = result.details || {};
        if (result.status !== "up") {
          hasErrors = true;
        }
      } catch (err) {
        hasErrors = true;
        details[name] = { status: "error", error: (err as Error).message };
      }
    }

    return this.getStatus(key, !hasErrors, details);
  }
}
