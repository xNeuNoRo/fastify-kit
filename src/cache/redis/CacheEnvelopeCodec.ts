import type { CacheEnvelope } from "../interfaces/CacheAdapter.js";

/**
 * @description Versión del formato serializado del envelope.
 * Si el formato evoluciona, este número permite rechazar (o migrar) entradas
 * escritas por versiones anteriores del framework.
 */
export const CACHE_ENVELOPE_FORMAT_VERSION = 1;

const ERROR_PREFIX = "[FastifyKit Cache]";

/**
 * @description Error de serialización/deserialización de datos de caché.
 * Indica que un valor no es almacenable en Redis o que una entrada persistida
 * no coincide con el formato esperado.
 */
export class CacheCodecError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`${ERROR_PREFIX} ${message}`, options);
    this.name = "CacheCodecError";
  }
}

/**
 * @description Forma serializada del envelope (formato JSON persistido en Redis).
 */
interface RawCacheEnvelope {
  _v: typeof CACHE_ENVELOPE_FORMAT_VERSION;
  value: unknown;
  namespaceVersion: number;
  storedAt: number;
  freshUntil: number | null;
  staleUntil: number | null;
  isNegative: boolean;
}

/**
 * @description Serializa un envelope a JSON.
 *
 * Reglas de serialización:
 * - `undefined` como valor raíz se persiste como `null` (JSON no soporta undefined).
 * - Los valores deben ser JSON-compatibles: primitivos, arrays, objetos planos,
 *   instancias de clase (enumerables), `Date` (ISO string) y `Buffer`/TypedArray
 *   (array de bytes). Se rechazan con `CacheCodecError`: `Map`, `Set`, `WeakMap`,
 *   `WeakSet`, `Promise`, `RegExp`, `Error`, `BigInt`, `Symbol`, funciones y
 *   referencias circulares (perderían datos silenciosamente).
 *
 * @throws {CacheCodecError} Si el valor no es serializable.
 */
export function encodeCacheEnvelope(envelope: CacheEnvelope): string {
  assertValidEnvelopeMetadata(envelope);
  assertJsonSerializable(envelope.value, "value");

  const payload: RawCacheEnvelope = {
    _v: CACHE_ENVELOPE_FORMAT_VERSION,
    value: envelope.value === undefined ? null : envelope.value,
    namespaceVersion: envelope.namespaceVersion,
    storedAt: envelope.storedAt,
    freshUntil: envelope.freshUntil,
    staleUntil: envelope.staleUntil,
    isNegative: envelope.isNegative,
  };

  return JSON.stringify(payload);
}

/**
 * @description Deserializa un envelope desde JSON con validación ESTRICTA de la forma.
 * Un JSON malformado o con estructura incompatible lanza `CacheCodecError`:
 * nunca se aceptan silenciosamente datos corruptos o de otra versión del formato.
 *
 * @throws {CacheCodecError} Si el JSON es inválido o la forma no coincide.
 */
export function decodeCacheEnvelope(raw: string): CacheEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CacheCodecError("Envelope corrupto: el JSON no es válido.", {
      cause: error,
    });
  }

  if (!isRawCacheEnvelope(parsed)) {
    throw new CacheCodecError(
      "Envelope corrupto: la estructura no coincide con el formato esperado. ¿Fue escrito por otra versión de FastifyKit o por otro consumidor del mismo Redis?",
    );
  }

  return {
    value: parsed.value,
    namespaceVersion: parsed.namespaceVersion,
    storedAt: parsed.storedAt,
    freshUntil: parsed.freshUntil,
    staleUntil: parsed.staleUntil,
    isNegative: parsed.isNegative,
  };
}

function isRawCacheEnvelope(value: unknown): value is RawCacheEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const envelope = value as Record<string, unknown>;
  return (
    envelope._v === CACHE_ENVELOPE_FORMAT_VERSION &&
    Object.hasOwn(envelope, "value") &&
    isValidNamespaceVersion(envelope.namespaceVersion) &&
    isValidTimestamp(envelope.storedAt) &&
    isValidExpiry(envelope.freshUntil, envelope.storedAt) &&
    isValidExpiry(envelope.staleUntil, envelope.storedAt) &&
    (envelope.staleUntil === null ||
      (envelope.freshUntil !== null &&
        envelope.staleUntil >= envelope.freshUntil)) &&
    (envelope.freshUntil !== null || envelope.staleUntil === null) &&
    typeof envelope.isNegative === "boolean" &&
    (!envelope.isNegative || envelope.value === null)
  );
}

function assertValidEnvelopeMetadata(envelope: CacheEnvelope): void {
  if (!isValidNamespaceVersion(envelope.namespaceVersion)) {
    throw new CacheCodecError(
      "Envelope inválido: namespaceVersion debe ser un entero seguro no negativo.",
    );
  }
  if (!isValidTimestamp(envelope.storedAt)) {
    throw new CacheCodecError(
      "Envelope inválido: storedAt debe ser un timestamp finito no negativo.",
    );
  }
  if (!isValidExpiry(envelope.freshUntil, envelope.storedAt)) {
    throw new CacheCodecError(
      "Envelope inválido: freshUntil debe ser null o un timestamp posterior a storedAt.",
    );
  }
  if (!isValidExpiry(envelope.staleUntil, envelope.storedAt)) {
    throw new CacheCodecError(
      "Envelope inválido: staleUntil debe ser null o un timestamp posterior a storedAt.",
    );
  }
  if (envelope.freshUntil === null && envelope.staleUntil !== null) {
    throw new CacheCodecError(
      "Envelope inválido: una entrada fresca permanente no puede tener ventana stale.",
    );
  }
  if (
    envelope.freshUntil !== null &&
    envelope.staleUntil !== null &&
    envelope.staleUntil < envelope.freshUntil
  ) {
    throw new CacheCodecError(
      "Envelope inválido: staleUntil no puede ser anterior a freshUntil.",
    );
  }
  if (typeof envelope.isNegative !== "boolean") {
    throw new CacheCodecError(
      "Envelope inválido: isNegative debe ser booleano.",
    );
  }
  if (envelope.isNegative && envelope.value !== null) {
    throw new CacheCodecError(
      "Envelope inválido: una entrada negativa debe tener value null.",
    );
  }
}

function isValidNamespaceVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isValidTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isValidExpiry(
  value: unknown,
  storedAt: number,
): value is number | null {
  return value === null || (isValidTimestamp(value) && value >= storedAt);
}

/**
 * @description Valida que un valor sea serializable a JSON sin pérdida de datos.
 * Recorre la estructura con un WeakSet de ancestros para detectar ciclos
 * (las referencias compartidas sin ciclo SÍ son válidas: JSON las duplica).
 */
function assertJsonSerializable(
  value: unknown,
  path: string,
  seen: WeakSet<object> = new WeakSet(),
): void {
  if (value === undefined) {
    if (path === "value") return;
    throw new CacheCodecError(
      `Valor no serializable en '${path}': undefined anidado se perdería al serializar JSON.`,
    );
  }
  if (value === null) return;

  switch (typeof value) {
    case "string":
    case "boolean":
      return;
    case "number":
      if (!Number.isFinite(value)) {
        throw new CacheCodecError(
          `Valor no serializable en '${path}': los números deben ser finitos.`,
        );
      }
      return;
    case "bigint":
      throw new CacheCodecError(
        `Valor no serializable en '${path}': BigInt no está soportado por JSON. Convierte el valor a string o number antes de cachearlo.`,
      );
    case "function":
      throw new CacheCodecError(
        `Valor no serializable en '${path}': las funciones no se pueden almacenar en caché.`,
      );
    case "symbol":
      throw new CacheCodecError(
        `Valor no serializable en '${path}': los símbolos no se pueden almacenar en caché.`,
      );
    case "object": {
      if (value instanceof Date || ArrayBuffer.isView(value)) return;
      if (value instanceof ArrayBuffer) return;
      if (
        value instanceof Map ||
        value instanceof Set ||
        value instanceof WeakMap ||
        value instanceof WeakSet ||
        value instanceof Promise ||
        value instanceof RegExp ||
        value instanceof Error
      ) {
        throw new CacheCodecError(
          `Valor no serializable en '${path}': ${value.constructor.name} no se puede almacenar sin pérdida de datos. Usa un objeto plano (DTO) en su lugar.`,
        );
      }

      if (seen.has(value)) {
        throw new CacheCodecError(
          `Valor no serializable en '${path}': referencia circular detectada.`,
        );
      }
      seen.add(value);

      if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index++) {
          assertJsonSerializable(value[index], `${path}[${index}]`, seen);
        }
      } else {
        for (const key of Object.keys(value)) {
          const member = (value as Record<string, unknown>)[key];
          assertJsonSerializable(member, path ? `${path}.${key}` : key, seen);
        }
      }

      seen.delete(value);
      return;
    }
  }
}
