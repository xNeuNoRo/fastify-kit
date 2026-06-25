import { TRACER_SERVICE_TOKEN, SpanKind, SpanStatusCode } from "../contracts/TracerService.js";
import type { SpanOptions } from "../contracts/TracerService.js";
import {
  SEMATTR_CODE_FUNCTION,
  SEMATTR_CODE_NAMESPACE,
} from "../utils/semantic-conventions.js";
import { container } from "../../container/DIContainer.js";

/**
 * @description Opciones del decorador \@Trace para personalizar el span de traza.
 * Permite definir el nombre, el tipo de span (SpanKind), atributos fijos,
 * y si se capturan los argumentos y/o el resultado del metodo.
 */
export interface TraceOptions {
  /** Nombre descriptivo de la operacion (si se omite, se usa "Clase.metodo") */
  name?: string;
  /** Tipo de span segun OpenTelemetry (INTERNAL, SERVER, CLIENT, PRODUCER, CONSUMER).
   *  Por defecto INTERNAL para operaciones internas sin limites de red. */
  kind?: SpanKind;
  /** Atributos estaticos que siempre se adjuntan al span (ej: { "db.table": "orders" }) */
  attributes?: Record<string, string | number | boolean>;
  /**
   * Si es true, captura todos los argumentos del metodo como atributos del span.
   * Si es un array de strings, solo captura los argumentos con esos nombres.
   * Ten cuidado: no captures datos sensibles (tokens, contraseñas, PII).
   * Los objetos se serializan como "[object]" para no inflar los spans.
   */
  captureArgs?: boolean | string[];
  /** Si es true, captura el valor de retorno como atributo del span (util para debugging). */
  captureResult?: boolean;
}

/**
 * @description Decorador que envuelve un metodo en un span de traza automatico.
 *
 * Al entrar al metodo se crea un span con los atributos semanticos de la operacion
 * (code.function, code.namespace) y los que el desarrollador haya especificado.
 * Al salir se registra el estado (OK o ERROR) y se cierra el span.
 *
 * Si el TracerService no esta disponible en el contenedor DI o esta desactivado,
 * el metodo se ejecuta normalmente sin ningun overhead.
 *
 * Soporta dos formas de uso:
 * - \@Trace("nombre.de.la.operacion")
 * - \@Trace({ name: "nombre", kind: SpanKind.CLIENT, attributes: { ... } })
 *
 * @param nameOrOptions Nombre del span (string) o configuracion completa (TraceOptions).
 * @returns Un decorador de metodo tipado que envuelve la ejecucion con trazado.
 *
 * @example
 * // Span simple con nombre personalizado
 * class OrderService {
 *   \@Trace("order.create")
 *   async createOrder(dto: CreateOrderDto) {
 *     await this.repo.save(dto); // El span se crea y cierra automaticamente
 *   }
 * }
 *
 * @example
 * // Span con atributos de negocio y captura de argumentos
 * class PaymentService {
 *   \@Trace({ name: "payment.process", captureArgs: true, kind: SpanKind.INTERNAL })
 *   async processPayment(amount: number, currency: string) {
 *     // El span tendra fn.args con los valores de amount y currency
 *     return this.gateway.charge(amount, currency);
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
    // El decorador solo tiene sentido en metodos; en clases o propiedades no aplica
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

      // Resolvemos el tracer del contenedor DI de forma lazy: asi si no hay
      // observabilidad configurada, el costo de este decorador es practicamente nulo
      try {
        tracer = container.resolve(TRACER_SERVICE_TOKEN);
      } catch {
        return target.apply(this, args);
      }

      // Si el tracer existe pero esta desactivado (tracing.enabled = false),
      // nos saltamos la creacion del span
      if (!tracer?.isEnabled?.()) {
        return target.apply(this, args);
      }

      // Construimos los atributos semanticos del span. Siempre incluimos
      // el nombre del metodo y la clase para filtrar en herramientas como Jaeger
      const attributes: Record<string, string | number | boolean> = {
        [SEMATTR_CODE_FUNCTION]: methodName,
        [SEMATTR_CODE_NAMESPACE]: className,
        ...(options.attributes || {}),
      };

      // Si el usuario pidio capturar argumentos, los serializamos de forma segura
      // (recortando a 1000 caracteres para no saturar el backend de trazas)
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
          // Si se pidio capturar el resultado, lo adjuntamos al span
          if (options.captureResult && res !== undefined) {
            try {
              span.setAttribute(
                "fn.result",
                typeof res === "object"
                  ? JSON.stringify(res).slice(0, 500)
                  : String(res),
              );
            } catch {
              // Podria fallar con referencias circulares, lo ignoramos
            }
          }
          span.setStatus(SpanStatusCode.OK);
          span.end();
          return res;
        };

        const handleError = (err: Error): never => {
          // Ante un error, dejamos trazabilidad completa: exception + estado ERROR
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
