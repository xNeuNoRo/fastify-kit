import type { CacheAdapter } from "./CacheAdapter.js";

/**
 * @description Lock distribuido adquirido por una instancia.
 *
 * El `token` es un identificador único de la adquisición (propiedad de la instancia).
 * La liberación SOLO debe ocurrir si el token coincide, para no liberar un lock
 * que ya fue renovado/heredado por otra instancia tras expirar el TTL.
 */
export interface CacheLock {
  /** Clave del lock. */
  key: string;
  /** Token único de la adquisición. */
  token: string;
  /** Momento en que el lock expira (epoch ms). */
  expiresAt: number;
}

/**
 * @description Mensaje de invalidación distribuida de caché.
 * Se publica por Pub/Sub para que todas las instancias limpien sus L1 locales.
 */
export interface CacheInvalidationMessage {
  /** Namespace afectado. */
  namespace: string;
  /** Nueva versión del namespace tras la invalidación. */
  namespaceVersion: number;
  /** Claves concretas afectadas (opcional: si no se provee, se invalida todo el namespace). */
  keys?: string[];
  /**
   * Identificador de la instancia que originó la invalidación.
   * El emisor ya aplicó su limpieza local directamente; los receptores lo usan
   * para ignorar su propio eco (evita doble limpieza y divergencia de versiones
   * locales). Ausente en mensajes de versiones anteriores del framework
   * (compatibilidad de deploys mixtos: un mensaje sin sourceId siempre se procesa).
   */
  sourceId?: string;
}

/**
 * @description Contrato de la capa L2 distribuida (Redis).
 *
 * Extiende `CacheAdapter` con las primitivas de coordinación entre instancias:
 * locks distribuidos y invalidación por Pub/Sub.
 *
 * Garantías declaradas:
 * - Pub/Sub es at-most-once: no hay replay ni durabilidad. Si una instancia está caída
 *   durante la invalidación, su L1 puede quedar stale hasta que expire por TTL o versión.
 * - Los locks tienen expiración propia; un cargador que tarde más que el TTL del lock
 *   puede ejecutarse en paralelo en otra instancia (duplicación posible, nunca deadlock).
 *
 * @example
 * const lock = await adapter.tryAcquireLock("users:123", 5_000);
 * if (lock !== null) {
 *   try {
 *     // Escribir o eliminar solo mientras esta instancia conserva el lock.
 *   } finally {
 *     await adapter.releaseLock(lock);
 *   }
 * }
 */
export interface DistributedCacheAdapter extends CacheAdapter {
  /**
   * @description Intenta adquirir un lock distribuido.
   * @param key Clave del lock.
   * @param ttlMs TTL del lock en milisegundos.
   * @returns El lock adquirido, o `null` si otra instancia lo posee.
   */
  tryAcquireLock(key: string, ttlMs: number): Promise<CacheLock | null>;

  /**
   * @description Libera un lock distribuido. Es seguro: solo lo libera si el token coincide.
   * @param lock El lock previamente adquirido.
   * @returns Una promesa que se resuelve cuando termina la liberación.
   */
  releaseLock(lock: CacheLock): Promise<void>;

  /**
   * Escribe solo mientras el token siga siendo dueño del lock. Devuelve false
   * si el lock expiró o fue adquirido por otra instancia.
   * @param key Clave de la entrada.
   * @param envelope Envelope que se escribirá.
   * @param lock Lock cuya propiedad debe seguir vigente.
   * @returns `true` si se escribió; `false` si el lock ya no pertenece a la instancia.
   */
  setWhileHoldingLock<T>(
    key: string,
    envelope: import("./CacheAdapter.js").CacheEnvelope<T>,
    lock: CacheLock,
  ): Promise<boolean>;

  /**
   * Elimina solo mientras el token siga siendo dueño del lock.
   * @param key Clave de la entrada.
   * @param lock Lock cuya propiedad debe seguir vigente.
   * @returns `true` si se eliminó; `false` si el lock ya no pertenece a la instancia.
   */
  deleteWhileHoldingLock(key: string, lock: CacheLock): Promise<boolean>;

  /**
   * @description Publica una invalidación para todas las instancias suscritas.
   * @param message Mensaje con namespace, versión y claves afectadas.
   * @returns Una promesa que se resuelve cuando termina la publicación.
   */
  publishInvalidation(message: CacheInvalidationMessage): Promise<void>;

  /**
   * @description Suscribe a las invalidaciones publicadas por otras instancias.
   * @param handler Función invocada por cada mensaje válido recibido.
   * @returns Función de desuscripción (debe usarse en el shutdown de la capa).
   * @throws {Error} Si el adaptador no puede crear la suscripción.
   */
  subscribeInvalidation(
    handler: (message: CacheInvalidationMessage) => void | Promise<void>,
  ): Promise<() => Promise<void>>;
}
