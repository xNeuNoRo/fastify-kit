import { LOGGER_TOKEN } from "../../logger/LoggerContract.js";
import type { LoggerContract } from "../../logger/LoggerContract.js";
import { container } from "../../container/DIContainer.js";

/** Niveles de log soportados por el decorador @Log, alineados con LoggerContract */
type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Despacha un mensaje de log al nivel correcto del logger.
 * Necesaria porque TypeScript no permite indexar LoggerContract con un string dinámico.
 */
function logAtLevel(
  logger: LoggerContract,
  level: LogLevel,
  message: string,
  context?: Record<string, any>,
): void {
  switch (level) {
    case "debug": logger.debug(message, context); break;
    case "info": logger.info(message, context); break;
    case "warn": logger.warn(message, context); break;
    case "error": logger.error(message, context); break;
    case "fatal": logger.fatal(message, context); break;
  }
}

/**
 * @description Opciones para el decorador @Log.
 * Permite registrar logs estructurados automáticamente al entrar/salir
 * de un método, con interpolación de argumentos y captura de entrada/salida/errores.
 */
export interface LogOptions {
  /** Nivel de log (debug, info, warn, error, fatal) */
  level: LogLevel;
  /**
   * Mensaje del log. Puede contener placeholders {{paramName}} que se
   * interpolan con los argumentos del método (si usas @UseParams).
   *
   * Ej: "Creando orden para usuario {{userId}} con monto {{amount}}"
   */
  message: string;
  /** Contexto adicional estático que se añade a todos los logs de este método */
  context?: Record<string, any>;
  /**
   * Capturar los argumentos del método en el log de entrada.
   * - true: captura todos los argumentos
   * - ["userId"]: captura solo argumentos específicos
   * Los objetos se serializan como "[object]" para evitar logs gigantes.
   */
  logInput?: boolean | string[];
  /** Registrar un log adicional con el resultado al terminar exitosamente */
  logOutput?: boolean;
  /** Registrar un log de error si el método lanza una excepción. Por defecto true */
  logError?: boolean;
}

/**
 * @description Decorador para logging estructurado automático.
 * Registra un log al entrar al método, y opcionalmente al salir (con resultado)
 * o al fallar (con error). Interpola placeholders {{paramName}} con los
 * argumentos del método usando los nombres de parámetros del metadata de clase.
 *
 * El contexto del log incluye automáticamente:
 * - class: nombre de la clase
 * - method: nombre del método
 * - durationMs: duración en ms (en logs de salida/error)
 * - input: argumentos capturados (si logInput está activado)
 * - output: valor de retorno (si logOutput está activado)
 * - error: mensaje, nombre y stack del error (si logError está activado)
 *
 * @param options Configuración del log
 * @returns Un decorador de método que envuelve la función original con logs
 *
 * @example
 * // Log básico con interpolación de argumentos
 * class OrderService {
 *   @Log({ level: "info", message: "Creando orden para usuario {{userId}}" })
 *   async createOrder(@Body() dto: CreateOrderDto) {
 *     // Log automático: "Creando orden para usuario usr_456"
 *     return this.repo.save(dto);
 *   }
 * }
 *
 * @example
 * // Log completo con entrada, salida y errores
 * class PaymentService {
 *   @Log({
 *     level: "info",
 *     message: "Procesando pago {{paymentId}}",
 *     logInput: true,
 *     logOutput: true,
 *     logError: true
 *   })
 *   async processPayment(paymentId: string) {
 *     // Log entrada: "Procesando pago pay_123" + { input: { paymentId: "pay_123" } }
 *     // Log salida: "Procesando pago pay_123 - completado" + { durationMs: 245, output: ... }
 *     // Log error: "Procesando pago pay_123 - fallido" + { error: { message: "...", stack: "..." } }
 *   }
 * }
 */
export function Log(options: LogOptions) {
  const {
    level,
    message,
    context: staticContext = {},
    logInput = false,
    logOutput = false,
    logError = true,
  } = options;

  return function <This, Args extends any[], Return>(
    target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >,
  ) {
    // Validamos que el decorador se aplique solo a métodos de clase
    if (context.kind !== "method") {
      throw new Error("@Log solo puede ser aplicado a métodos de clase");
    }

    const methodName = String(context.name);
    const className =
      (context.metadata as any)?.className || "UnknownClass";
    const paramNames =
      ((context.metadata as any)?.paramNames as string[]) || [];

    return function (this: This, ...args: Args): Return {
      let logger: LoggerContract;

      // Resolvemos el logger del contenedor DI
      try {
        logger = container.resolve<LoggerContract>(LOGGER_TOKEN);
      } catch {
        return target.apply(this, args);
      }

      const start = performance.now();

      // Interpolamos los placeholders {{paramName}} con los valores reales
      const interpolatedMessage = interpolateMessage(
        message,
        args,
        paramNames,
      );

      // Construimos el contexto base con clase, método y contexto estático
      const baseContext: Record<string, any> = {
        class: className,
        method: methodName,
        ...staticContext,
      };

      // Capturamos los argumentos de entrada si el usuario lo pide
      if (logInput) {
        const inputKeys =
          logInput === true ? paramNames : logInput;
        const inputContext: Record<string, any> = {};
        inputKeys.forEach((key: string, i: number) => {
          if (args[i] !== undefined) {
            try {
              inputContext[key] =
                typeof args[i] === "object"
                  ? "[object]"
                  : args[i];
            } catch {
              inputContext[key] = "[circular]";
            }
          }
        });
        baseContext.input = inputContext;
      }

      // Log de entrada
      logAtLevel(logger, level, interpolatedMessage, baseContext);

      try {
        const result = target.apply(this, args);

        // Manejamos el resultado (síncrono o asíncrono)
        const handleResult = (res: Return): Return => {
          const duration = performance.now() - start;

          if (logOutput) {
            let outputValue: any;
            try {
              outputValue =
                typeof res === "object"
                  ? "[object]"
                  : res;
            } catch {
              outputValue = "[circular]";
            }

            logAtLevel(
              logger,
              level,
              `${interpolatedMessage} - completado`,
              {
                ...baseContext,
                durationMs: Math.round(duration),
                output: outputValue,
              },
            );
          }

          return res;
        };

        const handleError = (err: Error): never => {
          if (logError) {
            logger.error(`${interpolatedMessage} - fallido`, {
              ...baseContext,
              durationMs: Math.round(performance.now() - start),
              error: {
                message: err.message,
                name: err.name,
                stack: err.stack?.split("\n").slice(0, 3).join("\n"),
              },
            });
          }
          throw err;
        };

        if (result instanceof Promise) {
          return result.then(handleResult).catch(handleError) as Return;
        }

        return handleResult(result);
      } catch (err) {
        if (logError) {
          logger.error(`${interpolatedMessage} - fallido`, {
            ...baseContext,
            durationMs: Math.round(performance.now() - start),
            error: {
              message: (err as Error).message,
              name: (err as Error).name,
              stack: (err as Error).stack
                ?.split("\n")
                .slice(0, 3)
                .join("\n"),
            },
          });
        }
        throw err;
      }
    };
  };
}

/**
 * @description Interpola placeholders {{paramName}} en un mensaje de log
 * reemplazándolos con los valores reales de los argumentos del método.
 *
 * @param template Plantilla del mensaje con placeholders (ej: "Creando orden para {{userId}}")
 * @param args Argumentos del método en orden
 * @param paramNames Nombres de los parámetros (del metadata de clase)
 * @returns Mensaje con los placeholders reemplazados por valores reales
 *
 * @example
 * interpolateMessage(
 *   "Creando orden para {{userId}}",
 *   ["usr_456", { items: [...] }],
 *   ["userId", "orderDto"]
 * )
 * // => "Creando orden para usr_456"
 */
function interpolateMessage(
  template: string,
  args: any[],
  paramNames: string[],
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const index = paramNames.indexOf(key);
    if (index >= 0 && args[index] !== undefined) {
      const val = args[index];
      if (typeof val === "object") {
        try {
          return JSON.stringify(val).slice(0, 200);
        } catch {
          return "[object]";
        }
      }
      return String(val);
    }
    return _match;
  });
}
