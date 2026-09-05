import type {
  BootstrapContext,
  BootstrapStep,
} from "../../core/bootstrap/BootstrapPipeline.js";
import { container } from "../../container/DIContainer.js";
import { CONFIG_SERVICE_TOKEN } from "../../config/ConfigService.js";
import {
  LOGGER_TOKEN,
  type LoggerContract,
} from "../../logger/LoggerContract.js";
import { METRICS_SERVICE_TOKEN } from "../contracts/MetricsService.js";
import { TRACER_SERVICE_TOKEN } from "../contracts/TracerService.js";
import {
  OBSERVABILITY_CONFIG_KEY,
  getDefaultObservabilityConfig,
} from "../contracts/ObservabilityConfig.js";
import { PinoLoggerService } from "../implementations/PinoLoggerService.js";
import { PromMetricsService } from "../implementations/PromMetricsService.js";
import { OtelTracerService } from "../implementations/OtelTracerService.js";

/**
 * @description Token para almacenar la información del endpoint de métricas.
 * Contiene la ruta, el contenido y el Content-Type para registrarlo en Fastify.
 * Lo usa el ObservabilityInstrumentationStep para añadir la ruta GET /metrics.
 */
export const METRICS_ENDPOINT_TOKEN = Symbol.for("METRICS_ENDPOINT_TOKEN");

/**
 * @description Realiza un merge profundo (recursivo) entre dos objetos planos.
 * Las propiedades del source sobrescriben las del target.
 * Si ambos valores son objetos, se mergean recursivamente.
 * Si no, source gana.
 *
 * Se usa para combinar la configuración del usuario con los defaults del framework.
 *
 * @example
 * deepMerge(
 *   { logging: { level: "info" }, tracing: { enabled: true } },
 *   { logging: { level: "debug" }, metrics: { endpoint: "/metrics" } }
 * )
 * // => { logging: { level: "debug" }, tracing: { enabled: true }, metrics: { endpoint: "/metrics" } }
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
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
      output[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      );
    } else {
      output[key] = source[key];
    }
  }
  return output;
}

/**
 * @description Paso 0 del pipeline de bootstrap de FastifyKit.
 * Se ejecuta antes que PreFlightStep para garantizar que los servicios
 * de observabilidad (logger, tracer, metrics) estén disponibles para
 * todo el resto del framework desde el primer momento.
 *
 * Orden de inicialización:
 * 1. Recupera la config de observabilidad del ConfigService (si existe)
 * 2. Hace merge con defaults inteligentes (development: console, production: otlp-http)
 * 3. Crea y registra PinoLoggerService (LOGGER_TOKEN)
 * 4. Crea y registra OtelTracerService (TRACER_SERVICE_TOKEN)
 * 5. Crea y registra PromMetricsService (METRICS_SERVICE_TOKEN)
 * 6. Registra METRICS_ENDPOINT_TOKEN para que el InstrumentationStep monte /metrics
 *
 * El nombre del servicio se toma de ctx.options.swagger.title si existe,
 * de lo contrario usa "fastify-kit-app".
 */
export class ObservabilityBootstrapStep implements BootstrapStep {
  readonly name = "ObservabilityBootstrapStep";

  async execute(ctx: BootstrapContext): Promise<void> {
    // Obtenemos la config por defecto y la mergeamos con la del usuario (si existe)
    const defaults = getDefaultObservabilityConfig();
    let obsConfig: Record<string, unknown> = { ...defaults };
    let hasObservabilityConfig = false;

    if (container.has(CONFIG_SERVICE_TOKEN)) {
      const configService = container.resolve<{
        getConfig: (key: string) => unknown;
      }>(CONFIG_SERVICE_TOKEN);
      const userConfig = configService.getConfig?.(OBSERVABILITY_CONFIG_KEY) as
        | Record<string, unknown>
        | undefined;
      if (userConfig) {
        obsConfig = deepMerge(
          defaults as unknown as Record<string, unknown>,
          userConfig,
        );
        hasObservabilityConfig = true;
      }
    }

    // El nombre del servicio se toma del título de Swagger o del default
    obsConfig.serviceName = ctx.options?.swagger?.title || defaults.serviceName;

    // Logger: siempre registramos Pino (si esta configurado o por defecto)
    // Si Pino falla, hace fallback a console automaticamente
    if (hasObservabilityConfig && !container.has(LOGGER_TOKEN)) {
      const logger = new PinoLoggerService(
        obsConfig.logging as {
          level: string;
          prettyPrint: boolean;
        },
      );
      container.registerInstance(LOGGER_TOKEN, logger);
    }

    // Tracer y metrics son opt-in independientes.
    const tracingConfig = obsConfig.tracing as
      | {
          enabled: boolean;
          sampler: string;
          ratio: number;
          exporter: string;
          otlpEndpoint?: string;
          otlpHeaders?: Record<string, string>;
        }
      | undefined;

    let tracer: OtelTracerService | undefined;
    if (hasObservabilityConfig && tracingConfig?.enabled) {
      const tracerLogger = container.has(LOGGER_TOKEN)
        ? container.resolve<LoggerContract>(LOGGER_TOKEN)
        : undefined;
      tracer = new OtelTracerService(tracingConfig, tracerLogger);
      container.registerInstance(TRACER_SERVICE_TOKEN, tracer);
    }

    const metricsConfig = obsConfig.metrics as
      | {
          enabled: boolean;
          endpoint: string;
          defaultLabels: Record<string, string>;
        }
      | undefined;
    if (hasObservabilityConfig && metricsConfig?.enabled) {
      const metrics = new PromMetricsService(metricsConfig, tracer);
      await metrics.ready;
      container.registerInstance(METRICS_SERVICE_TOKEN, metrics);
      container.registerInstance(METRICS_ENDPOINT_TOKEN, {
        endpoint: metricsConfig.endpoint,
        getContent: () => metrics.getMetricsEndpointAsync(),
        getContentType: () => metrics.getContentType(),
      });
    }
  }
}
