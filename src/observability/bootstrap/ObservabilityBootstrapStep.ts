import type { BootstrapContext, BootstrapStep } from "../../core/bootstrap/BootstrapPipeline.js";
import { container } from "../../container/DIContainer.js";
import { CONFIG_SERVICE_TOKEN } from "../../config/ConfigService.js";
import { LOGGER_TOKEN } from "../../logger/LoggerContract.js";
import { METRICS_SERVICE_TOKEN } from "../contracts/MetricsService.js";
import { TRACER_SERVICE_TOKEN } from "../contracts/TracerService.js";
import {
  OBSERVABILITY_CONFIG_KEY,
  getDefaultObservabilityConfig,
} from "../contracts/ObservabilityConfig.js";
import { PinoLoggerService } from "../implementations/PinoLoggerService.js";
import { PromMetricsService } from "../implementations/PromMetricsService.js";
import { OtelTracerService } from "../implementations/OtelTracerService.js";

export const METRICS_ENDPOINT_TOKEN = Symbol.for("METRICS_ENDPOINT_TOKEN");

function deepMerge(
  target: Record<string, any>,
  source: Record<string, any>,
): Record<string, any> {
  const output = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      output[key] = deepMerge(target[key], source[key]);
    } else {
      output[key] = source[key];
    }
  }
  return output;
}

export class ObservabilityBootstrapStep implements BootstrapStep {
  readonly name = "ObservabilityBootstrapStep";

  async execute(ctx: BootstrapContext): Promise<void> {
    const defaults = getDefaultObservabilityConfig();
    let obsConfig: Record<string, any> = { ...defaults };

    if (container.has(CONFIG_SERVICE_TOKEN)) {
      const configService = container.resolve<any>(CONFIG_SERVICE_TOKEN);
      const userConfig = configService.getConfig?.(OBSERVABILITY_CONFIG_KEY);
      if (userConfig) {
        obsConfig = deepMerge(defaults, userConfig);
      }
    }

    obsConfig.serviceName =
      ctx.options?.swagger?.title || defaults.serviceName;

    const logger = new PinoLoggerService(obsConfig.logging as any);
    container.registerInstance(LOGGER_TOKEN, logger);

    const tracer = new OtelTracerService(
      obsConfig.tracing as any,
      logger,
    );
    container.registerInstance(TRACER_SERVICE_TOKEN, tracer);

    const metrics = new PromMetricsService(
      obsConfig.metrics,
      tracer,
    );
    container.registerInstance(METRICS_SERVICE_TOKEN, metrics);

    container.registerInstance(METRICS_ENDPOINT_TOKEN, {
      endpoint: obsConfig.metrics.endpoint,
      getContent: () => metrics.getMetricsEndpoint(),
      getContentType: () => metrics.getContentType(),
    });
  }
}
