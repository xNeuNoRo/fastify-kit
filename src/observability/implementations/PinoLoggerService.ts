import { Injectable } from "../../container/injectable.decorator.js";
import type { LoggerContract } from "../../logger/LoggerContract.js";
import { requestContext } from "../../http/context/requestContext.js";
import type { ObservabilityConfig } from "../contracts/ObservabilityConfig.js";

let pinoModule: any = null;
let pinoLokiModule: any = null;

async function loadPino() {
  if (!pinoModule) {
    pinoModule = await import("pino");
  }
  return pinoModule;
}

async function loadPinoLoki() {
  if (!pinoLokiModule) {
    try {
      pinoLokiModule = await import("pino-loki");
    } catch {
      pinoLokiModule = { default: null };
    }
  }
  return pinoLokiModule;
}

@Injectable()
export class PinoLoggerService implements LoggerContract {
  private initialized = false;
  private logger: any = console;
  private pinoLogger: any = null;

  private config: {
    level: string;
    prettyPrint: boolean;
    loki?: {
      url: string;
      labels: Record<string, string>;
      batchSize: number;
      interval: number;
    };
  };

  constructor(config: {
    level: string;
    prettyPrint: boolean;
    loki?: {
      url: string;
      labels: Record<string, string>;
      batchSize: number;
      interval: number;
    };
  }) {
    this.config = config;
    this.init().catch(() => {});
  }

  private async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const pino = await loadPino();
      const pinoLoki = await loadPinoLoki();

      const level = this.config.level || "info";

      const transportTargets: any[] = [
        {
          target: "pino/file",
          level,
          options: { destination: 1 },
        },
      ];

      if (this.config.loki && this.config.loki.url && pinoLoki?.default) {
        try {
          transportTargets.push({
            target: "pino-loki",
            level,
            options: {
              host: this.config.loki.url,
              labels: this.config.loki.labels || {},
              batching: {
                batchSize: this.config.loki.batchSize || 100,
                interval: this.config.loki.interval || 5000,
              },
            },
          });
        } catch (lokiError) {
          console.warn(
            "[PinoLoggerService] Failed to configure Loki transport:",
            (lokiError as Error).message,
          );
        }
      }

      const transport = pino.transport({
        targets: transportTargets,
      });

      this.pinoLogger = pino.pino(
        {
          level,
          ...(this.config.prettyPrint
            ? {
                transport: {
                  target: "pino-pretty",
                  options: { colorize: true, translateTime: "HH:MM:ss Z", ignore: "pid,hostname" },
                },
              }
            : {}),
        },
        this.config.prettyPrint ? undefined : transport,
      );

      this.logger = this.pinoLogger;
    } catch (err) {
      console.warn(
        "[PinoLoggerService] Failed to initialize pino, falling back to console:",
        (err as Error).message,
      );
      this.logger = console;
    }
  }

  private enrichContext(ctx?: Record<string, any>): Record<string, any> {
    const store = requestContext.getStore();
    return {
      ...(ctx || {}),
      ...(store?.requestId ? { requestId: store.requestId } : {}),
    };
  }

  info(message: string, ctx?: Record<string, any>): void {
    this.logger.info(this.enrichContext(ctx), message);
  }

  warn(message: string, ctx?: Record<string, any>): void {
    this.logger.warn(this.enrichContext(ctx), message);
  }

  error(message: string, ctx?: Record<string, any>): void {
    this.logger.error(this.enrichContext(ctx), message);
  }

  debug(message: string, ctx?: Record<string, any>): void {
    this.logger.debug(this.enrichContext(ctx), message);
  }

  fatal(message: string, ctx?: Record<string, any>): void {
    this.logger.fatal(this.enrichContext(ctx), message);
  }

  getPinoLogger(): any {
    return this.pinoLogger || this.logger;
  }
}
