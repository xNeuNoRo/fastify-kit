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
    let obsConfig: Record<string, any> = { ...defaults };

    if (container.has(CONFIG_SERVICE_TOKEN)) {
      const configService = container.resolve<any>(CONFIG_SERVICE_TOKEN);
      const userConfig = configService.getConfig?.(OBSERVABILITY_CONFIG_KEY);
      if (userConfig) {
        obsConfig = deepMerge(defaults, userConfig);
      }
    }

    // El nombre del servicio se toma del título de Swagger o del default
    obsConfig.serviceName =
      ctx.options?.swagger?.title || defaults.serviceName;

    // Instanciamos los servicios y los registramos en el contenedor DI

    // Logger: Pino con soporte de Loki y pretty-print
    const logger = new PinoLoggerService(obsConfig.logging as any);
    container.registerInstance(LOGGER_TOKEN, logger);

    // Tracer: OpenTelemetry SDK con sampling configurable
    const tracer = new OtelTracerService(
      obsConfig.tracing as any,
      logger,
    );
    container.registerInstance(TRACER_SERVICE_TOKEN, tracer);

    // Metrics: Prometheus con exemplars
    const metrics = new PromMetricsService(
      obsConfig.metrics,
      tracer,
    );
    container.registerInstance(METRICS_SERVICE_TOKEN, metrics);

    // Guardamos la info del endpoint para montarlo luego en Fastify
    container.registerInstance(METRICS_ENDPOINT_TOKEN, {
      endpoint: obsConfig.metrics.endpoint,
      getContent: () => metrics.getMetricsEndpoint(),
      getContentType: () => metrics.getContentType(),
    });
  }
}
