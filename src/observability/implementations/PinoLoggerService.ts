import { Injectable } from "../../container/injectable.decorator.js";
import type { LoggerContract } from "../../logger/LoggerContract.js";
import { requestContext } from "../../http/context/requestContext.js";
import type { ObservabilityConfig } from "../contracts/ObservabilityConfig.js";

let pinoModule: any = null;
let pinoLokiModule: any = null;

/**
 * Carga dinámica de Pino. Usamos import dinámico para que el servicio
 * sea usable incluso si pino no está instalado (fallback a console).
 */
async function loadPino() {
  if (!pinoModule) {
    pinoModule = await import("pino");
  }
  return pinoModule;
}

/**
 * Carga dinámica de pino-loki. Si no está disponible, los logs
 * se envían solo a stdout (el sidecar de Loki los recogerá igual).
 */
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

/**
 * @description Implementación del LoggerContract usando Pino para logging
 * estructurado con soporte de niveles (trace a fatal), correlación automática
 * de requestId via AlsStore (AsyncLocalStorage), y envío opcional a Loki.
 *
 * Si Pino no está disponible, fallback silencioso a console.log.
 * Si pino-loki no está disponible, solo se loguea a stdout (sidecar Loki/Promtail).
 *
 * Se instancia en ObservabilityBootstrapStep y se registra con LOGGER_TOKEN.
 * Reemplaza al DefaultConsoleLogger con logs JSON estructurados.
 *
 * @example
 * // El usuario no instancia esto directamente, lo hace el framework:
 * const logger = new PinoLoggerService({
 *   level: "info",
 *   prettyPrint: true,
 *   loki: { url: "http://loki:3100", labels: { service: "orders-api" } }
 * });
 * container.registerInstance(LOGGER_TOKEN, logger);
 *
 * // En cualquier servicio, se resuelve normalmente:
 * @Inject(LOGGER_TOKEN) private logger: LoggerContract;
 * this.logger.info("Peticion procesada", { userId: "usr_456" });
 * // Sale como JSON con requestId, timestamp, level...
 */
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

  /**
   * Inicializa Pino de forma asíncrona. Configura transports:
   * - stdout (siempre) con el nivel solicitado
   * - Loki (opcional) si se proporcionó URL y pino-loki está disponible
   * - pretty-print (opcional) para desarrollo local
   */
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
            "[PinoLoggerService] Error configurando transporte Loki:",
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
        "[PinoLoggerService] Error inicializando Pino, usando console como fallback:",
        (err as Error).message,
      );
      this.logger = console;
    }
  }

  /**
   * Enriquece el contexto del log con datos del request actual.
   * Extrae el requestId del AlsStore (AsyncLocalStorage) para
   * correlacionar logs con la petición que los generó.
   *
   * En el futuro también inyectará traceId y spanId del tracer activo.
   */
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

  /**
   * Expone la instancia interna de Pino para casos avanzados
   * (ej: integración con pino-http para logs de Fastify).
   */
  getPinoLogger(): any {
    return this.pinoLogger || this.logger;
  }
}
