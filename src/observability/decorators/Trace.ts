import { TRACER_SERVICE_TOKEN, SpanKind, SpanStatusCode } from "../contracts/TracerService.js";
import type { SpanOptions } from "../contracts/TracerService.js";
import {
  SEMATTR_CODE_FUNCTION,
  SEMATTR_CODE_NAMESPACE,
} from "../utils/semantic-conventions.js";
import { container } from "../../container/DIContainer.js";

/**
 * @description Opciones para el decorador @Trace.
 * Permite personalizar el nombre del span, el tipo (SpanKind),
 * atributos estáticos y captura de argumentos/resultado.
 */
export interface TraceOptions {
  /** Nombre personalizado del span. Si no se especifica, se usa "ClassName.methodName" */
  name?: string;
  /** Tipo de span (INTERNAL, SERVER, CLIENT, PRODUCER, CONSUMER). Por defecto INTERNAL */
  kind?: SpanKind;
  /** Atributos semánticos estáticos que se añaden al span siempre */
  attributes?: Record<string, string | number | boolean>;
  /**
   * Capturar los argumentos del método como atributos del span.
   * - true: captura todos los argumentos
   * - ["userId", "orderId"]: captura solo los argumentos con esos nombres (si usas @UseParams)
   * Cuidado: no capturar datos sensibles (contraseñas, tokens, PII)
   */
  captureArgs?: boolean | string[];
  /** Capturar el valor de retorno como atributo del span. Útil para debugging */
  captureResult?: boolean;
}

/**
 * @description Decorador para crear un span de traza automático alrededor de un método.
 * Inyecta el TracerService del contenedor DI y maneja tanto métodos síncronos como asíncronos.
 * Si el tracer no está disponible o está desactivado, el método se ejecuta normalmente sin overhead.
 *
 * Acepta dos formas de uso:
 * - @Trace("nombre.del.span") — solo nombre del span
 * - @Trace({ name: "nombre", kind: SpanKind.CLIENT, attributes: {...} }) — config completa
 *
 * El span registra automáticamente:
 * - Atributos semánticos: code.function (nombre del método), code.namespace (nombre de la clase)
 * - Atributos de negocio: los especificados en `attributes`
 * - Argumentos: si captureArgs está activado
 * - Resultado: si captureResult está activado
 * - Excepciones: recordException + SpanStatusCode.ERROR
 *
 * @param nameOrOptions Nombre del span (string) u opciones completas (TraceOptions)
 * @returns Un decorador de método que envuelve la función original con un span de traza
 *
 * @example
 * // Span automático con nombre simple
 * class OrderService {
 *   @Trace("order.create")
 *   async createOrder(dto: CreateOrderDto) {
 *     // El span se crea al entrar y se cierra al salir
 *     await this.repo.save(dto);
 *   }
 * }
 *
 * @example
 * // Span con atributos de negocio
 * class PaymentService {
 *   @Trace({ name: "payment.process", captureArgs: true })
 *   async processPayment(amount: number, currency: string) {
 *     // El span tendrá: fn.args = '[100,"USD"]'
 *   }
 * }
 */
export function Trace(nameOrOptions: string | TraceOptions = {}) {
  const options: TraceOptions =
    typeof nameOrOptions === "string"
      ? { name: nameOrOptions }
      : nameOrOptions;

  return function <This, Args extends any[], Return>(
    target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >,
  ) {
    // Validamos que el decorador se aplique solo a métodos de clase
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

      // Resolvemos el tracer del contenedor DI (lazy, no en tiempo de definición)
      try {
        tracer = container.resolve(TRACER_SERVICE_TOKEN);
      } catch {
        // Si no hay tracer registrado, ejecutamos el método sin span
        return target.apply(this, args);
      }

      if (!tracer?.isEnabled?.()) {
        return target.apply(this, args);
      }

      // Construimos los atributos del span
      const attributes: Record<string, string | number | boolean> = {
        [SEMATTR_CODE_FUNCTION]: methodName,
        [SEMATTR_CODE_NAMESPACE]: className,
        ...(options.attributes || {}),
      };

      // Capturamos argumentos si el usuario lo pide
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

      // Creamos el span
      const span = tracer.startSpan(spanName, spanOptions);

      try {
        const result = target.apply(this, args);

        // Manejamos el resultado (síncrono o asíncrono)
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
              // Referencia circular u otro problema de serialización
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
