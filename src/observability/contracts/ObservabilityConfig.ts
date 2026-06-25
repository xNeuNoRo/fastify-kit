import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";

/**
 * @description Esquema TypeBox para validar la configuración completa de observabilidad.
 * Define la estructura de logs, trazas, métricas e instrumentaciones automáticas.
 * Se utiliza en ConfigModule para habilitar el sistema de observabilidad nativa.
 *
 * Cada sección tiene valores por defecto inteligentes:
 * - Development: sampler always_on, logs prettyPrint, exporter console
 * - Production: sampler parentbased_traceidratio 0.1, exporter otlp-http
 */
export const ObservabilityConfigSchema = Type.Object(
  {
    /** Nombre identificador del servicio (aparece en traces, métricas, logs) */
    serviceName: Type.String({ minLength: 1 }),
    /** Entorno de despliegue (development, staging, production) */
    environment: Type.Union(
      [
        Type.Literal("development"),
        Type.Literal("staging"),
        Type.Literal("production"),
      ],
      { default: "development" },
    ),

    /** Configuración del sistema de logging estructurado (Pino) */
    logging: Type.Object({
      /** Nivel mínimo de log: trace < debug < info < warn < error */
      level: Type.Union(
        [
          Type.Literal("trace"),
          Type.Literal("debug"),
          Type.Literal("info"),
          Type.Literal("warn"),
          Type.Literal("error"),
        ],
        { default: "info" },
      ),
      /** Activar pretty-print para desarrollo (colores, formato legible). En producción: false */
      prettyPrint: Type.Boolean({ default: false }),
      /** Configuración opcional para enviar logs a Loki (Grafana) */
      loki: Type.Optional(
        Type.Object({
          /** URL del endpoint de Loki (ej: http://loki:3100/loki/api/v1/push) */
          url: Type.String(),
          /** Labels fijas para todos los logs enviados a Loki */
          labels: Type.Record(Type.String(), Type.String()),
          /** Tamaño del batch de logs a enviar (por defecto 100) */
          batchSize: Type.Number({ default: 100 }),
          /** Intervalo en ms entre envíos de batch (por defecto 5000) */
          interval: Type.Number({ default: 5000 }),
        }),
      ),
    }),

    /** Configuración de trazado distribuido (OpenTelemetry) */
    tracing: Type.Object({
      /** Activar/desactivar el envío de trazas */
      enabled: Type.Boolean({ default: true }),
      /**
       * Estrategia de muestreo (sampling):
       * - always_on: Todas las trazas (desarrollo)
       * - always_off: Ninguna traza (desactivado)
       * - traceidratio: Muestrear % fijo de trazas nuevas
       * - parentbased_traceidratio: Respeta decisión del padre + % fijo para raíces (producción recomendado)
       */
      sampler: Type.Union(
        [
          Type.Literal("always_on"),
          Type.Literal("always_off"),
          Type.Literal("traceidratio"),
          Type.Literal("parentbased_traceidratio"),
        ],
        { default: "parentbased_traceidratio" },
      ),
      /** Ratio de muestreo (0.0 a 1.0) para traceidratio y parentbased_traceidratio. Por defecto 10% */
      ratio: Type.Optional(
        Type.Number({ minimum: 0, maximum: 1, default: 0.1 }),
      ),
      /**
       * Exportador de trazas:
       * - otlp-grpc: OpenTelemetry Collector via gRPC
       * - otlp-http: OpenTelemetry Collector via HTTP (recomendado)
       * - console: Imprime trazas en consola (desarrollo)
       * - none: No exporta (traza solo métricas internas)
       */
      exporter: Type.Union(
        [
          Type.Literal("otlp-grpc"),
          Type.Literal("otlp-http"),
          Type.Literal("console"),
          Type.Literal("none"),
        ],
        { default: "otlp-http" },
      ),
      /** Endpoint del OpenTelemetry Collector (ej: http://otel-collector:4318/v1/traces) */
      otlpEndpoint: Type.Optional(Type.String()),
      /** Headers HTTP adicionales para autenticación con el collector */
      otlpHeaders: Type.Optional(
        Type.Record(Type.String(), Type.String()),
      ),
    }),

    /** Configuración de métricas (Prometheus) */
    metrics: Type.Object({
      /** Activar/desactivar la recolección y el endpoint /metrics */
      enabled: Type.Boolean({ default: true }),
      /** Ruta del endpoint de métricas (por defecto /metrics para scrape de Prometheus) */
      endpoint: Type.String({ default: "/metrics" }),
      /** Labels por defecto que se añaden a todas las métricas (ej: { team: "backend", region: "eu-west" }) */
      defaultLabels: Type.Record(Type.String(), Type.String(), {
        default: {},
      }),
      /** URL del Pushgateway de Prometheus (para jobs batch) */
      pushGateway: Type.Optional(Type.String()),
      /** Intervalo en ms entre push al gateway (por defecto 30000) */
      pushInterval: Type.Number({ default: 30000 }),
    }),

    /** Qué subsistemas instrumentar automáticamente */
    instrumentations: Type.Object({
      /** Instrumentar peticiones HTTP (Fastify onRequest/onResponse/onError) */
      http: Type.Boolean({ default: true }),
      /** Instrumentar comandos Redis (ioredis) */
      redis: Type.Boolean({ default: true }),
      /** Instrumentar colas de trabajo (QueueManager) */
      queue: Type.Boolean({ default: true }),
      /** Instrumentar WebSockets (WssGatewayRegistry) */
      ws: Type.Boolean({ default: true }),
    }),
  },
  { additionalProperties: false },
);

/**
 * @description Tipo inferido del esquema de observabilidad.
 * Representa la configuración completa de logs, trazas, métricas e instrumentaciones.
 */
export type ObservabilityConfig = Static<typeof ObservabilityConfigSchema>;

/**
 * @description Clave para almacenar la configuración de observabilidad en ConfigService.
 * Se usa internamente para que el ObservabilityBootstrapStep recupere la config.
 */
export const OBSERVABILITY_CONFIG_KEY = "observability" as const;

/**
 * @description Devuelve la configuración por defecto de observabilidad.
 * Valores seguros para desarrollo. En producción, el usuario debe sobrescribir
 * al menos serviceName, environment, y exporter.
 *
 * @returns Configuración por defecto con valores seguros para desarrollo local.
 */
export function getDefaultObservabilityConfig(): {
  serviceName: string;
  environment: string;
  logging: { level: string; prettyPrint: boolean };
  tracing: {
    enabled: boolean;
    sampler: string;
    ratio: number;
    exporter: string;
    otlpEndpoint?: string;
  };
  metrics: { enabled: boolean; endpoint: string; defaultLabels: Record<string, string> };
  instrumentations: {
    http: boolean;
    redis: boolean;
    queue: boolean;
    ws: boolean;
  };
} {
  return {
    serviceName: "fastify-kit-app",
    environment: "development",
    logging: { level: "info", prettyPrint: true },
    tracing: {
      enabled: true,
      sampler: "parentbased_traceidratio",
      ratio: 0.1,
      exporter: "console",
    },
    metrics: { enabled: true, endpoint: "/metrics", defaultLabels: {} },
    instrumentations: { http: true, redis: true, queue: true, ws: true },
  };
}
