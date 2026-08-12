/**
 * @description Token para inyectar el servicio de trazas distribuidas (OpenTelemetry)
 * en el contenedor de dependencias. Se resuelve en el ObservabilityBootstrapStep.
 */
export const TRACER_SERVICE_TOKEN = Symbol.for("TRACER_SERVICE_TOKEN");

/**
 * @description Contexto de un span (identificador único de operación dentro de una traza).
 * Implementa el estándar W3C Trace Context para propagación entre servicios.
 * - traceId: 32 caracteres hex (identifica la traza completa a través de todos los servicios)
 * - spanId: 16 caracteres hex (identifica esta operación específica dentro de la traza)
 * - traceFlags: 01 = sampled (se enviará al backend), 00 = no sampled
 * - traceState: metadatos adicionales del vendor (opcional)
 */
export interface SpanContext {
  traceId: string;
  spanId: string;
  traceFlags?: number;
  traceState?: string;
}

/**
 * @description Representa un span individual (operación medida) dentro de una traza distribuida.
 * Cada span tiene un nombre, atributos semánticos, eventos y estado (OK/ERROR).
 * Se crea con tracer.startSpan() y se cierra con span.end().
 *
 * Un span puede contener:
 * - Atributos: pares clave-valor (ej: "http.method": "POST")
 * - Eventos: puntos en el tiempo con atributos (ej: "cache.hit")
 * - Excepciones: errores capturados con stack trace
 * - Estado: OK o ERROR con mensaje descriptivo
 *
 * @example
 * const span = tracer.startSpan("db.insert", { attributes: { "db.table": "orders" } });
 * try {
 *   await database.insert(order);
 *   span.setStatus(SpanStatusCode.OK);
 * } catch (err) {
 *   span.recordException(err);
 *   span.setStatus(SpanStatusCode.ERROR, err.message);
 * } finally {
 *   span.end();
 * }
 */
export interface Span {
  /** ID único de este span (16 caracteres hex) */
  spanId: string;
  /** ID de la traza completa a la que pertenece (32 caracteres hex) */
  traceId: string;
  /** Nombre descriptivo de la operación (ej: "db.insert", "http.request") */
  name: string;
  /** Añade un atributo al span (clave-valor semántico) */
  setAttribute(key: string, value: string | number | boolean): void;
  /** Añade múltiples atributos de una vez */
  setAttributes(attrs: Record<string, string | number | boolean>): void;
  /** Registra un evento puntual con atributos opcionales (ej: "cache.hit") */
  addEvent(
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ): void;
  /** Registra una excepción con su stack trace y marca el span como ERROR */
  recordException(error: Error): void;
  /** Establece el estado final del span (OK o ERROR) */
  setStatus(code: SpanStatusCode, message?: string): void;
  /** Finaliza el span y lo envía al exportador configurado */
  end(endTime?: bigint): void;
}

/**
 * @description Tipo de span según OpenTelemetry.
 * Define el rol de la operación en el sistema distribuido.
 *
 * - INTERNAL (0): Operación interna sin límites de red (ej: cálculo, transformación)
 * - SERVER (1): Recibir una petición entrante (ej: Fastify onRequest)
 * - CLIENT (2): Enviar una petición saliente (ej: fetch a API externa)
 * - PRODUCER (3): Publicar un mensaje en una cola/tópico (ej: QueueManager.dispatch)
 * - CONSUMER (4): Recibir un mensaje de una cola/tópico (ej: WorkerPool procesando job)
 */
export enum SpanKind {
  INTERNAL = 0,
  SERVER = 1,
  CLIENT = 2,
  PRODUCER = 3,
  CONSUMER = 4,
}

/**
 * @description Estado de finalización de un span.
 *
 * - UNSET (0): No se ha establecido estado (por defecto)
 * - OK (1): La operación se completó exitosamente
 * - ERROR (2): La operación falló con un error
 */
export enum SpanStatusCode {
  UNSET = 0,
  OK = 1,
  ERROR = 2,
}

/** Opciones para crear un span */
export interface SpanOptions {
  kind?: SpanKind;
  attributes?: Record<string, string | number | boolean>;
  parentContext?: SpanContext;
}

/**
 * @description Contrato para el servicio de trazado distribuido.
 * Proporciona creación de spans, propagación de contexto W3C (traceparent + baggage),
 * y gestión del ciclo de vida del SDK de OpenTelemetry.
 *
 * Se implementa en OtelTracerService usando @opentelemetry/sdk-node.
 * El usuario puede inyectarlo con \@Inject(TRACER_SERVICE_TOKEN) o usar el decorador \@Trace.
 *
 * @example
 * class OrderService {
 *   constructor(@Inject(TRACER_SERVICE_TOKEN) private tracer: TracerService) {}
 *
 *   async createOrder(dto: CreateOrderDto) {
 *     return this.tracer.startActiveSpan("order.create", async (span) => {
 *       span.setAttribute("order.id", dto.id);
 *       // ... lógica de negocio ...
 *       span.setStatus(SpanStatusCode.OK);
 *     });
 *   }
 * }
 */
export interface TracerService {
  /** Crea un span manual. Debes llamar a span.end() al terminar */
  startSpan(name: string, options?: SpanOptions): Span;
  /** Crea un span activo por callback. El span se cierra automáticamente al salir */
  startActiveSpan<T>(name: string, fn: (span: Span) => T, options?: SpanOptions): T;
  /** Finaliza un span creado con startSpan */
  endSpan(span: Span): void;
  /** Inyecta el contexto de traza actual en headers HTTP (W3C traceparent) */
  inject(carrier: Record<string, string>): void;
  /** Extrae el contexto de traza de headers HTTP entrantes */
  extract(carrier: Record<string, string>): SpanContext | null;
  /** Obtiene el span activo actual (útil para exemplars de métricas) */
  getActiveSpan(): Span | undefined;
  /** Establece un valor de baggage (contexto de negocio que viaja entre servicios) */
  setBaggage(key: string, value: string): void;
  /** Obtiene un valor del baggage actual */
  getBaggage(key: string): string | undefined;
  /** Obtiene todos los valores del baggage actual */
  getAllBaggage(): Record<string, string>;
  /** Limpia todo el baggage actual */
  clearBaggage(): void;
  /** Verifica si el tracer está activo y funcionando */
  isEnabled(): boolean;
  /** Apaga el SDK de OpenTelemetry y vacía los buffers pendientes */
  shutdown(): Promise<void>;
}
