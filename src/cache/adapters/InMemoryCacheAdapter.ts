import type {
  CacheAdapter,
  CacheEnvelope,
} from "../interfaces/CacheAdapter.js";
import { isEnvelopeExpired } from "../interfaces/CacheResult.js";
import { extractCacheNamespace } from "../namespace.js";

/**
 * @description Adaptador L1 de caché: almacén en memoria local al proceso.
 *
 * Semántica:
 * - Expiración lazy: los envelopes expirados se eliminan al leerlos, sin timers.
 * - LRU por orden de acceso: al superar `maxSize` se descartan las entradas
 *   menos recientemente usadas (el `Map` preserva el orden de inserción y
 *   `get`/`set` reinsertan la clave al final).
 * - Coherencia por versión: `clearNamespace`/`clearAll` incrementan la versión
 *   del namespace, invalidando cualquier envelope escrito con una versión anterior
 *   (incluidos los escritos concurrentemente después de la limpieza).
 *
 * Este adaptador NO ejecuta cargadores ni decide políticas: es un almacén puro.
 */
export class InMemoryCacheAdapter implements CacheAdapter {
  private readonly store = new Map<string, CacheEnvelope<unknown>>();
  private readonly versions = new Map<string, number>();
  private readonly maxSize: number;
  private globalVersion = 0;

  constructor(options: { maxSize: number }) {
    this.maxSize = options.maxSize;
  }

  async get<T>(key: string): Promise<CacheEnvelope<T> | null> {
    const envelope = this.store.get(key);
    if (!envelope) return null;

    if (this.isInvalidated(key, envelope) || isEnvelopeExpired(envelope)) {
      this.store.delete(key);
      return null;
    }

    // Reinsertamos para mantener el orden LRU (acceso reciente al final).
    this.store.delete(key);
    this.store.set(key, envelope);
    return envelope as CacheEnvelope<T>;
  }

  async set<T>(key: string, envelope: CacheEnvelope<T>): Promise<void> {
    this.store.delete(key);
    this.store.set(key, envelope);
    this.evictIfNeeded();
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clearNamespace(namespace: string): Promise<void> {
    const prefix = `${namespace}:`;
    for (const key of this.store.keys()) {
      if (key === namespace || key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
    this.bumpVersion(namespace);
  }

  async clearAll(): Promise<void> {
    this.store.clear();
    this.globalVersion++;
  }

  async clearEntries(): Promise<void> {
    this.store.clear();
  }

  async getVersion(namespace: string): Promise<number> {
    return Math.max(this.globalVersion, this.versions.get(namespace) ?? 0);
  }

  async setVersion(namespace: string, version: number): Promise<void> {
    if (namespace === "*") {
      this.globalVersion = Math.max(this.globalVersion, version);
      return;
    }
    const current = this.versions.get(namespace) ?? 0;
    if (version > current) {
      this.versions.set(namespace, version);
    }
  }

  private isInvalidated(key: string, envelope: CacheEnvelope): boolean {
    const currentVersion = Math.max(
      this.globalVersion,
      this.versions.get(extractCacheNamespace(key)) ?? 0,
    );
    return envelope.namespaceVersion < currentVersion;
  }

  private bumpVersion(namespace: string): void {
    this.versions.set(namespace, (this.versions.get(namespace) ?? 0) + 1);
  }

  private evictIfNeeded(): void {
    while (this.store.size > this.maxSize) {
      const oldestKey = this.store.keys().next().value as string | undefined;
      if (oldestKey === undefined) return;
      this.store.delete(oldestKey);
    }
  }
}
