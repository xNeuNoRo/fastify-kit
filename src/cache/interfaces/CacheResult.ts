import type { CacheEnvelope } from "./CacheAdapter.js";

/**
 * @description Resultado de una lectura de caché.
 * - "miss": no existe una entrada utilizable (incluye entradas expiradas).
 * - "fresh": la entrada está dentro de su ventana fresca.
 * - "stale": la entrada venció su ventana fresca pero aún es servible (si la política lo permite).
 * - "negative": la entrada es caché negativa (el loader devolvió vacío previamente).
 */
export type CacheLookupStatus = "miss" | "fresh" | "stale" | "negative";

/**
 * @description Resultado tipado de una lectura de caché.
 * Permite distinguir explícitamente un valor cacheado `null` de un miss real.
 */
export interface CacheLookup<T = unknown> {
  status: CacheLookupStatus;
  /** Envelope de la entrada, o `null` si el estado es "miss". */
  envelope: CacheEnvelope<T> | null;
}

/**
 * @description Frescura calculada de una entrada viva (no expirada).
 */
export type CacheEnvelopeFreshness = "fresh" | "stale";

/**
 * @description Indica si una entrada está expirada según el reloj actual.
 * Una entrada con `freshUntil` y `staleUntil` nulos (permanente) nunca expira.
 * @param envelope Envelope a evaluar.
 * @param now Instante de referencia (epoch ms). Por defecto `Date.now()`.
 */
export function isEnvelopeExpired(
  envelope: CacheEnvelope,
  now: number = Date.now(),
): boolean {
  if (envelope.staleUntil !== null) {
    return now > envelope.staleUntil;
  }
  return envelope.freshUntil !== null && now > envelope.freshUntil;
}

/**
 * @description Calcula la frescura de una entrada VIVA (llamar solo si `isEnvelopeExpired` es falso).
 * - Entrada permanente o dentro de `freshUntil` → "fresh".
 * - Dentro de la ventana stale → "stale".
 * @param envelope Envelope a evaluar.
 * @param now Instante de referencia (epoch ms). Por defecto `Date.now()`.
 */
export function getEnvelopeFreshness(
  envelope: CacheEnvelope,
  now: number = Date.now(),
): CacheEnvelopeFreshness {
  if (envelope.freshUntil === null || now <= envelope.freshUntil) {
    return "fresh";
  }
  return "stale";
}

/**
 * @description Datos de entrada para construir un envelope.
 */
export interface CacheEnvelopeInput<T> {
  /** Valor a almacenar. */
  value: T;
  /** Versión del namespace en el momento de la escritura. */
  namespaceVersion: number;
  /** Momento de escritura (epoch ms). Por defecto `Date.now()` (útil fijarlo en tests). */
  storedAt?: number;
  /**
   * TTL fresco en milisegundos.
   * `null`, `0` o negativo → entrada permanente (sin expiración).
   */
  freshTtlMs: number | null;
  /**
   * TTL total servible desde `storedAt` en milisegundos (fresh + stale).
   * `undefined`, `null`, `0` o negativo → sin ventana stale (expira al vencer `freshTtlMs`).
   * Si es menor que `freshTtlMs`, se normaliza al TTL fresco para evitar un
   * envelope cuya ventana stale termine antes que la fresca.
   */
  staleTtlMs?: number | null;
  /** `true` si la entrada es caché negativa. Por defecto `false`. */
  isNegative?: boolean;
}

/**
 * @description Construye un envelope a partir de TTLs, resolviendo las marcas de tiempo
 * de forma consistente. Centraliza la semántica de expiración para que decorators,
 * servicio de caché y adapters no la reimplementen por separado.
 */
export function createCacheEnvelope<T>(
  input: CacheEnvelopeInput<T>,
): CacheEnvelope<T> {
  const storedAt = input.storedAt ?? Date.now();
  const freshUntil =
    input.freshTtlMs !== null && input.freshTtlMs > 0
      ? storedAt + input.freshTtlMs
      : null;
  const staleUntil =
    freshUntil !== null &&
    input.staleTtlMs !== undefined &&
    input.staleTtlMs !== null &&
    input.staleTtlMs > 0
      ? storedAt + Math.max(input.staleTtlMs, input.freshTtlMs ?? 0)
      : null;

  return {
    value: input.value,
    namespaceVersion: input.namespaceVersion,
    storedAt,
    freshUntil,
    staleUntil,
    isNegative: input.isNegative ?? false,
  };
}
