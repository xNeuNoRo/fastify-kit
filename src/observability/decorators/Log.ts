import { LOGGER_TOKEN } from "../../logger/LoggerContract.js";
import type { LoggerContract } from "../../logger/LoggerContract.js";
import { container } from "../../container/DIContainer.js";

type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

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

export interface LogOptions {
  level: LogLevel;
  message: string;
  context?: Record<string, any>;
  logInput?: boolean | string[];
  logOutput?: boolean;
  logError?: boolean;
}

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

      try {
        logger = container.resolve<LoggerContract>(LOGGER_TOKEN);
      } catch {
        return target.apply(this, args);
      }

      const start = performance.now();
      const interpolatedMessage = interpolateMessage(
        message,
        args,
        paramNames,
      );

      const baseContext: Record<string, any> = {
        class: className,
        method: methodName,
        ...staticContext,
      };

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

      logAtLevel(logger, level, interpolatedMessage, baseContext);

      try {
        const result = target.apply(this, args);

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
              `${interpolatedMessage} - completed`,
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
            logger.error(`${interpolatedMessage} - failed`, {
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
          logger.error(`${interpolatedMessage} - failed`, {
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
