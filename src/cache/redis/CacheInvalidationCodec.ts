import type { CacheInvalidationMessage } from "../interfaces/DistributedCacheAdapter.js";
import { extractCacheNamespace, validateCacheNamespace } from "../namespace.js";
import { CacheCodecError } from "./CacheEnvelopeCodec.js";

/**
 * @description Forma serializada del mensaje de invalidación (JSON sobre Pub/Sub).
 */
interface RawInvalidationMessage {
  namespace: string;
  namespaceVersion: number;
  keys?: string[];
  sourceId?: string;
}

const MAX_INVALIDATION_MESSAGE_BYTES = 64 * 1024;
const MAX_INVALIDATION_KEYS = 1_024;
const MAX_SOURCE_ID_LENGTH = 128;

/**
 * @description Serializa un mensaje de invalidación a JSON.
 * `keys` y `sourceId` se omiten cuando están vacíos para reducir el payload.
 */
export function encodeInvalidationMessage(
  message: CacheInvalidationMessage,
): string {
  if (!isRawInvalidationMessage(message)) {
    throw new CacheCodecError(
      "Mensaje de invalidación inválido: la estructura no coincide con el formato esperado.",
    );
  }
  const payload: RawInvalidationMessage = {
    namespace: message.namespace,
    namespaceVersion: message.namespaceVersion,
  };
  if (message.keys !== undefined && message.keys.length > 0) {
    payload.keys = message.keys;
  }
  if (message.sourceId !== undefined) {
    payload.sourceId = message.sourceId;
  }
  const encoded = JSON.stringify(payload);
  if (Buffer.byteLength(encoded, "utf8") > MAX_INVALIDATION_MESSAGE_BYTES) {
    throw new CacheCodecError(
      "Mensaje de invalidación demasiado grande para el canal Redis.",
    );
  }
  return encoded;
}

/**
 * @description Deserializa un mensaje de invalidación con validación ESTRICTA.
 * Un mensaje malformado (JSON inválido o forma incompatible) lanza `CacheCodecError`
 * para que el suscriptor lo ignore sin romper el loop de mensajes.
 *
 * @throws {CacheCodecError} Si el JSON es inválido o la forma no coincide.
 */
export function decodeInvalidationMessage(
  raw: string,
): CacheInvalidationMessage {
  if (Buffer.byteLength(raw, "utf8") > MAX_INVALIDATION_MESSAGE_BYTES) {
    throw new CacheCodecError(
      "Mensaje de invalidación demasiado grande para el canal Redis.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CacheCodecError(
      "Mensaje de invalidación corrupto: el JSON no es válido.",
      { cause: error },
    );
  }

  if (!isRawInvalidationMessage(parsed)) {
    throw new CacheCodecError(
      "Mensaje de invalidación corrupto: la estructura no coincide con el formato esperado.",
    );
  }

  return {
    namespace: parsed.namespace,
    namespaceVersion: parsed.namespaceVersion,
    keys: parsed.keys,
    sourceId: parsed.sourceId,
  };
}

function isRawInvalidationMessage(
  value: unknown,
): value is RawInvalidationMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  const namespace = message.namespace;

  if (
    typeof namespace !== "string" ||
    (namespace !== "*" && !isValidNamespace(namespace))
  ) {
    return false;
  }
  if (
    typeof message.namespaceVersion !== "number" ||
    !Number.isSafeInteger(message.namespaceVersion) ||
    message.namespaceVersion < 0
  ) {
    return false;
  }
  if (
    message.keys !== undefined &&
    (!Array.isArray(message.keys) ||
      message.keys.length > MAX_INVALIDATION_KEYS ||
      message.keys.some((key) => {
        if (typeof key !== "string" || !isMessageKeyValid(key)) return true;
        return namespace !== "*" && !isMessageKeyInNamespace(key, namespace);
      }))
  ) {
    return false;
  }
  if (
    message.sourceId !== undefined &&
    (typeof message.sourceId !== "string" ||
      message.sourceId.length === 0 ||
      message.sourceId.length > MAX_SOURCE_ID_LENGTH)
  ) {
    return false;
  }
  return true;
}

function isValidNamespace(namespace: string): boolean {
  try {
    validateCacheNamespace(namespace);
    return true;
  } catch {
    return false;
  }
}

function isMessageKeyInNamespace(key: string, namespace: string): boolean {
  try {
    return extractCacheNamespace(key) === namespace;
  } catch {
    return false;
  }
}

function isMessageKeyValid(key: string): boolean {
  try {
    extractCacheNamespace(key);
    return true;
  } catch {
    return false;
  }
}
