import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";

export const ObservabilityConfigSchema = Type.Object(
  {
    serviceName: Type.String({ minLength: 1 }),
    environment: Type.Union(
      [
        Type.Literal("development"),
        Type.Literal("staging"),
        Type.Literal("production"),
      ],
      { default: "development" },
    ),

    logging: Type.Object({
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
      prettyPrint: Type.Boolean({ default: false }),
      loki: Type.Optional(
        Type.Object({
          url: Type.String(),
          labels: Type.Record(Type.String(), Type.String()),
          batchSize: Type.Number({ default: 100 }),
          interval: Type.Number({ default: 5000 }),
        }),
      ),
    }),

    tracing: Type.Object({
      enabled: Type.Boolean({ default: true }),
      sampler: Type.Union(
        [
          Type.Literal("always_on"),
          Type.Literal("always_off"),
          Type.Literal("traceidratio"),
          Type.Literal("parentbased_traceidratio"),
        ],
        { default: "parentbased_traceidratio" },
      ),
      ratio: Type.Optional(
        Type.Number({ minimum: 0, maximum: 1, default: 0.1 }),
      ),
      exporter: Type.Union(
        [
          Type.Literal("otlp-grpc"),
          Type.Literal("otlp-http"),
          Type.Literal("console"),
          Type.Literal("none"),
        ],
        { default: "otlp-http" },
      ),
      otlpEndpoint: Type.Optional(Type.String()),
      otlpHeaders: Type.Optional(
        Type.Record(Type.String(), Type.String()),
      ),
    }),

    metrics: Type.Object({
      enabled: Type.Boolean({ default: true }),
      endpoint: Type.String({ default: "/metrics" }),
      defaultLabels: Type.Record(Type.String(), Type.String(), {
        default: {},
      }),
      pushGateway: Type.Optional(Type.String()),
      pushInterval: Type.Number({ default: 30000 }),
    }),

    instrumentations: Type.Object({
      http: Type.Boolean({ default: true }),
      redis: Type.Boolean({ default: true }),
      queue: Type.Boolean({ default: true }),
      ws: Type.Boolean({ default: true }),
    }),
  },
  { additionalProperties: false },
);

export type ObservabilityConfig = Static<typeof ObservabilityConfigSchema>;

export const OBSERVABILITY_CONFIG_KEY = "observability" as const;

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
