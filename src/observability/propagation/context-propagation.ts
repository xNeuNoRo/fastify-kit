import type { TracerService } from "../contracts/TracerService.js";
import type { SpanContext } from "../contracts/TracerService.js";

/**
 * @description Inyecta el contexto de traza actual (W3C traceparent) en un carrier HTTP.
 * Útil antes de hacer peticiones HTTP salientes para propagar la traza al servicio downstream.
 *
 * @example
 * const headers: Record<string, string> = {};
 * injectTraceContext(headers, tracer);
 * await fetch("https://api.externa.com/data", { headers });
 */
export function injectTraceContext(
  carrier: Record<string, string>,
  tracer: TracerService,
): void {
  tracer.inject(carrier);
}

/**
 * @description Extrae el contexto de traza de headers HTTP entrantes.
 * Se usa al recibir una petición para continuar la traza iniciada por el
 * servicio que nos llamó (trace propagation).
 *
 * @example
 * const parentContext = extractTraceContext({
 *   traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
 *   baggage: "userId=usr_456,tenantId=tenant_789"
 * }, tracer);
 * // Ahora creamos spans hijos de este trace
 * tracer.startSpan("mi.operacion", { parentContext });
 */
export function extractTraceContext(
  carrier: Record<string, string>,
  tracer: TracerService,
): SpanContext | null {
  return tracer.extract(carrier);
}

/**
 * @description Inyecta el baggage actual (contexto de negocio) en un carrier HTTP.
 * A diferencia de traceparent (técnico), el baggage lleva datos de negocio
 * como userId, tenantId, featureFlags que viajan entre servicios.
 *
 * @example
 * tracer.setBaggage("userId", "usr_456");
 * const headers: Record<string, string> = {};
 * injectBaggage(headers, tracer);
 * // headers.baggage = "userId=usr_456"
 */
export function injectBaggage(
  carrier: Record<string, string>,
  tracer: TracerService,
): void {
  const baggage = tracer.getAllBaggage();
  if (Object.keys(baggage).length > 0) {
    const pairs = Object.entries(baggage).map(
      ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`,
    );
    carrier["baggage"] = pairs.join(",");
  }
}

/**
 * @description Parsea el header HTTP 'baggage' de W3C a un objeto clave-valor.
 * El formato es: clave1=valor1,clave2=valor2 (valores URL-encoded).
 *
 * @param header Valor del header HTTP 'baggage'
 * @returns Objeto con las claves y valores decodificados
 *
 * @example
 * const baggage = parseBaggageHeader("userId=usr_456,tenantId=tenant_789");
 * console.log(baggage.userId); // "usr_456"
 * console.log(baggage.tenantId); // "tenant_789"
 */
export function parseBaggageHeader(
  header: string,
): Record<string, string> {
  if (!header) return {};
  const result: Record<string, string> = {};

  const pairs = header.split(",");
  for (const pair of pairs) {
    const eqIndex = pair.indexOf("=");
    if (eqIndex === -1) continue;
    const key = decodeURIComponent(pair.slice(0, eqIndex).trim());
    const value = decodeURIComponent(pair.slice(eqIndex + 1).trim());
    if (key && value) {
      result[key] = value;
    }
  }

  return result;
}
