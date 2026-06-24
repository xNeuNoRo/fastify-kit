export const TRACER_SERVICE_TOKEN = Symbol.for("TRACER_SERVICE_TOKEN");

export interface SpanContext {
  traceId: string;
  spanId: string;
  traceFlags?: number;
  traceState?: string;
}

export interface Span {
  spanId: string;
  traceId: string;
  name: string;
  setAttribute(key: string, value: string | number | boolean): void;
  setAttributes(attrs: Record<string, string | number | boolean>): void;
  addEvent(
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ): void;
  recordException(error: Error): void;
  setStatus(code: SpanStatusCode, message?: string): void;
  end(endTime?: bigint): void;
}

export enum SpanKind {
  INTERNAL = 0,
  SERVER = 1,
  CLIENT = 2,
  PRODUCER = 3,
  CONSUMER = 4,
}

export enum SpanStatusCode {
  UNSET = 0,
  OK = 1,
  ERROR = 2,
}

export interface SpanOptions {
  kind?: SpanKind;
  attributes?: Record<string, string | number | boolean>;
  parentContext?: SpanContext;
}

export interface TracerService {
  startSpan(name: string, options?: SpanOptions): Span;
  startActiveSpan<T>(name: string, fn: (span: Span) => T, options?: SpanOptions): T;
  endSpan(span: Span): void;
  inject(carrier: Record<string, string>): void;
  extract(carrier: Record<string, string>): SpanContext | null;
  getActiveSpan(): Span | undefined;
  setBaggage(key: string, value: string): void;
  getBaggage(key: string): string | undefined;
  getAllBaggage(): Record<string, string>;
  clearBaggage(): void;
  isEnabled(): boolean;
  shutdown(): Promise<void>;
}
