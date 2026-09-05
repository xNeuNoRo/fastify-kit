/**
 * @description Extrae el namespace de una clave de caché.
 * El namespace es el primer segmento de la clave, separado por ":".
 * Ejemplo: "users:getUser:123" → "users".
 * Si la clave no contiene ":", la clave completa es el namespace.
 *
 * Esta es la convención única de particionado de la caché: la usan
 * CacheManager, los adapters y el servicio de caché para resolver
 * configuración por namespace, versionado e invalidación.
 */
export function extractCacheNamespace(key: string): string {
  if (
    key.length === 0 ||
    key.length > 4096 ||
    /[\u0000-\u001f\u007f]/.test(key)
  ) {
    throw new Error(
      "[FastifyKit Cache] La clave debe tener entre 1 y 4096 caracteres y no contener caracteres de control.",
    );
  }
  const separatorIndex = key.indexOf(":");
  const namespace = separatorIndex === -1 ? key : key.slice(0, separatorIndex);
  validateCacheNamespace(namespace);
  return namespace;
}

export function validateCacheNamespace(namespace: string): void {
  if (
    namespace.length === 0 ||
    namespace.length > 128 ||
    !/^[A-Za-z0-9._-]+$/.test(namespace)
  ) {
    throw new Error(
      "[FastifyKit Cache] El namespace debe tener entre 1 y 128 caracteres alfanuméricos, '.', '_' o '-'.",
    );
  }
}

export function hashCacheKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}
import { createHash } from "node:crypto";
