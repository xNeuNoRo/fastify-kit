import { LOGGER_TOKEN } from "../../logger/LoggerContract.js";
import type { LoggerContract } from "../../logger/LoggerContract.js";
import { container } from "../../container/DIContainer.js";

/** Niveles de log soportados por el decorador \@Log. Mapean 1:1 con los metodos de LoggerContract. */
type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Despacha un mensaje de log al metodo correcto del logger segun el nivel.
 * Hacemos esto en lugar de logger[level](msg, ctx) porque TypeScript no puede
 * verificar que un string dinamico sea una clave valida de LoggerContract.
 */
function logAtLevel(
  logger: LoggerContract,
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
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
 * @description Opciones del decorador \@Log para registrar logs estructurados
 * automaticamente al entrar y salir de un metodo.
 *
 * Soporta interpolacion de argumentos via placeholders {{paramName}}
 * que se reemplazan con los valores reales en tiempo de ejecucion.
 */
export interface LogOptions {
  /** Nivel de severidad del log (debug, info, warn, error, fatal) */
  level: LogLevel;
  /**
   * Plantilla del mensaje. Podes usar {{paramName}} para interpolar argumentos
   * del metodo en el mensaje. Los nombres de parametro se obtienen del metadata
   * de la clase (si usas \@Body, \@Param, etc.).
   *
   * Ej: "Procesando orden {{orderId}} para el usuario {{userId}}"
   */
  message: string;
  /** Contexto adicional fijo que se adjunta a todos los logs de este metodo (ej: { modulo: "pagos" }) */
  context?: Record<string, unknown>;
  /**
   * Si es true, captura todos los argumentos del metodo en el log de entrada.
   * Si es un array, solo captura los argumentos listados.
   * Los objetos se serializan como "[object]" para evitar logs gigantes.
   */
  logInput?: boolean | string[];
  /** Si es true, registra un log adicional con el resultado al terminar exitosamente */
  logOutput?: boolean;
  /** Si es false, no se registra log cuando el metodo lanza una excepcion. Por defecto true. */
  logError?: boolean;
}

/**
 * @description Decorador que registra logs estructurados al entrar, salir y fallar un metodo.
 *
 * Al entrar se loguea el mensaje interpolado con los argumentos.
 * Al salir exitosamente, opcionalmente se loguea el resultado con la duracion en ms.
 * Al fallar, se loguea el error con mensaje, stack trace y duracion.
 *
 * Utiliza el LoggerContract del contenedor DI. Si no hay logger disponible, el metodo
 * se ejecuta normalmente sin logs.
 *
 * @param options Configuracion de los logs (nivel, mensaje, captura de entrada/salida/errores).
 * @returns Un decorador de metodo que envuelve la ejecucion con logs estructurados.
 *
 * @example
 * // Log simple con interpolacion de argumentos
 * class OrderService {
 *   \@Log({ level: "info", message: "Creando orden para usuario {{userId}}" })
 *   async createOrder(dto: CreateOrderDto) {
 *     // Log automatico: "Creando orden para usuario usr_456"
 *     return this.repo.save(dto);
 *   }
 * }
 *
 * @example
 * // Log completo con entrada, duracion y errores
 * class PaymentGateway {
 *   \@Log({
 *     level: "info",
 *     message: "Procesando pago {{paymentId}}",
 *     logInput: true,
 *     logOutput: true,
 *     logError: true
 *   })
 *   async charge(paymentId: string) {
 *     // Log entrada: "Procesando pago pay_123" + contexto con argumentos
 *     // Log salida: "Procesando pago pay_123 - completado" + duracion en ms
 *     // Log error: "Procesando pago pay_123 - fallido" + stack trace
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
    // Solo tiene sentido en metodos, no en clases ni propiedades
    if (context.kind !== "method") {
      throw new Error("@Log solo puede ser aplicado a métodos de clase");
    }

    const methodName = String(context.name);
    const meta = (context.metadata ?? {}) as Record<string, unknown>;
    const className = (meta.className as string) || "UnknownClass";
    const paramNames = (meta.paramNames as string[]) || [];

    return function (this: This, ...args: Args): Return {
      let logger: LoggerContract;

      // Resolucion lazy del logger desde DI: si no hay logger, el metodo corre igual
      try {
        logger = container.resolve<LoggerContract>(LOGGER_TOKEN);
      } catch {
        return target.apply(this, args);
      }

      const start = performance.now();

      // Reemplazamos los placeholders {{paramName}} con los valores reales de los argumentos
      const interpolatedMessage = interpolateMessage(
        message,
        args,
        paramNames,
      );

      const baseContext: Record<string, unknown> = {
        class: className,
        method: methodName,
        ...staticContext,
      };

      // Si el usuario quiere ver los argumentos en el log de entrada, los capturamos
      if (logInput) {
        const inputKeys =
          logInput === true ? paramNames : logInput;
        const inputContext: Record<string, unknown> = {};
        inputKeys.forEach((key: string, i: number) => {
          if (args[i] !== undefined) {
            try {
              inputContext[key] =
                typeof args[i] === "object"
                  ? "[object]"
                  : String(args[i]);
            } catch {
              inputContext[key] = "[circular]";
            }
          }
        });
        baseContext.input = inputContext;
      }

      // Log de entrada: registramos que el metodo comenzo a ejecutarse
      logAtLevel(logger, level, interpolatedMessage, baseContext);

      try {
        const result = target.apply(this, args);

        const handleResult = (res: Return): Return => {
          const duration = performance.now() - start;

          // Log de salida exitosa con duracion y resultado (si el usuario lo pidio)
          if (logOutput) {
            let outputValue: unknown;
            try {
              outputValue =
                typeof res === "object"
                  ? "[object]"
                  : String(res);
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
          // Log de error con stack trace (recortado a las primeras 3 lineas para no saturar)
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
 * @description Reemplaza los placeholders {{paramName}} en una plantilla de log
 * con los valores reales de los argumentos del metodo.
 *
 * Busca en paramNames el indice del parametro y usa el valor correspondiente de args.
 * Si el valor es un objeto, lo serializa a JSON truncado a 200 caracteres.
 * Si no encuentra el parametro, deja el placeholder tal cual.
 *
 * @param template Plantilla con placeholders (ej: "Procesando orden {{orderId}}")
 * @param args Argumentos del metodo en orden
 * @param paramNames Nombres de los parametros (del metadata de la clase)
 * @returns La plantilla con los placeholders reemplazados por valores reales
 *
 * @example
 * interpolateMessage(
 *   "Creando orden para {{userId}}",
 *   ["usr_456"],
 *   ["userId"]
 * )
 * // => "Creando orden para usr_456"
 */
function interpolateMessage(
  template: string,
  args: unknown[],
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
