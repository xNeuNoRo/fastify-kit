import type { TracerService } from "../contracts/TracerService.js";
import type { SpanContext } from "../contracts/TracerService.js";

export function injectTraceContext(
  carrier: Record<string, string>,
  tracer: TracerService,
): void {
  tracer.inject(carrier);
}

export function extractTraceContext(
  carrier: Record<string, string>,
  tracer: TracerService,
): SpanContext | null {
  return tracer.extract(carrier);
}

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
