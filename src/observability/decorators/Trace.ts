import { TRACER_SERVICE_TOKEN, SpanKind, SpanStatusCode } from "../contracts/TracerService.js";
import type { SpanOptions } from "../contracts/TracerService.js";
import {
  SEMATTR_CODE_FUNCTION,
  SEMATTR_CODE_NAMESPACE,
} from "../utils/semantic-conventions.js";
import { container } from "../../container/DIContainer.js";

export interface TraceOptions {
  name?: string;
  kind?: SpanKind;
  attributes?: Record<string, string | number | boolean>;
  captureArgs?: boolean | string[];
  captureResult?: boolean;
}

export function Trace(options: TraceOptions = {}) {
  return function <This, Args extends any[], Return>(
    target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >,
  ) {
    if (context.kind !== "method") {
      throw new Error("@Trace solo puede ser aplicado a métodos de clase");
    }

    const methodName = String(context.name);
    const className =
      (context.metadata as any)?.className || "UnknownClass";
    const spanName =
      options.name || `${className}.${methodName}`;

    return function (this: This, ...args: Args): Return {
      let tracer: any;

      try {
        tracer = container.resolve(TRACER_SERVICE_TOKEN);
      } catch {
        return target.apply(this, args);
      }

      if (!tracer?.isEnabled?.()) {
        return target.apply(this, args);
      }

      const attributes: Record<string, string | number | boolean> = {
        [SEMATTR_CODE_FUNCTION]: methodName,
        [SEMATTR_CODE_NAMESPACE]: className,
        ...(options.attributes || {}),
      };

      if (options.captureArgs) {
        const argNames =
          options.captureArgs === true ? [] : options.captureArgs;
        const captured: Record<string, any> = {};
        args.forEach((arg, i) => {
          if (argNames.length === 0 || argNames.includes(String(i))) {
            try {
              captured[String(i)] =
                typeof arg === "object" ? "[object]" : arg;
            } catch {
              captured[String(i)] = "[circular]";
            }
          }
        });
        attributes["fn.args"] = JSON.stringify(captured).slice(0, 1000);
      }

      const spanOptions: SpanOptions = {
        kind: options.kind ?? SpanKind.INTERNAL,
        attributes,
      };

      const span = tracer.startSpan(spanName, spanOptions);

      try {
        const result = target.apply(this, args);

        const handleResult = (res: Return): Return => {
          if (options.captureResult && res !== undefined) {
            try {
              span.setAttribute(
                "fn.result",
                typeof res === "object"
                  ? JSON.stringify(res).slice(0, 500)
                  : String(res),
              );
            } catch {
              // circular reference or other serialization issue
            }
          }
          span.setStatus(SpanStatusCode.OK);
          span.end();
          return res;
        };

        const handleError = (err: Error): never => {
          span.recordException(err);
          span.setStatus(SpanStatusCode.ERROR, err.message);
          span.end();
          throw err;
        };

        if (result instanceof Promise) {
          return result.then(handleResult).catch(handleError) as Return;
        }

        return handleResult(result);
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus(SpanStatusCode.ERROR, (err as Error).message);
        span.end();
        throw err;
      }
    };
  };
}
