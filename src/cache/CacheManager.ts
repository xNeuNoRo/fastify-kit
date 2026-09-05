import { getCacheAdapter } from "./cache.factory.js";
import type { CacheServiceGetOrLoadOptions } from "./CacheService.js";
import { createCacheEnvelope } from "./interfaces/CacheResult.js";
import { extractCacheNamespace, validateCacheNamespace } from "./namespace.js";

/**
 * @description Forma mínima de un adaptador con soporte nativo de get-or-load
 * (el CacheService del framework). Se detecta por duck-typing para no acoplar
 * la API pública a la clase concreta.
 */
interface GetOrLoadCapable {
  getOrLoad<T>(
    key: string,
    loader: () => Promise<T>,
    options?: CacheServiceGetOrLoadOptions,
  ): Promise<T>;
}

/**
 * @description API pública de la caché de FastifyKit.
 *
 * Desde la versión con caché distribuida, la API es ASÍNCRONA:
 * todos los métodos retornan `Promise` para poder delegar en Redis cuando el
 * modo de caché lo requiera, sin distinguir la firma según la configuración.
 *
 * La resolución del adaptador delegada en `getCacheAdapter()` hace que el
 * comportamiento efectivo dependa de la configuración distribuida
 * (`distributed.features.cache`), pero el contrato de la API es estable.
 */
export class CacheManager {
  /**
   * @description Obtiene un valor de la caché por su clave.
   * @param key La clave única que identifica el valor almacenado en caché
   * (suele construirse como `namespace:metodo:argumentos`).
   * @returns El valor almacenado, o `null` si no existe o ha expirado.
   * @throws {Error} Si el adaptador no puede completar la lectura.
   * @example
   * const user = await CacheManager.get<User>("users:123");
   */
  static async get<T>(key: string): Promise<T | null> {
    const adapter = await getCacheAdapter();
    const envelope = await adapter.get<T>(key);
    return envelope ? envelope.value : null;
  }

  /**
   * @description Obtiene un valor de la caché cargándolo con el `loader` si no
   * existe una entrada servible. Es la operación recomendada para lecturas con
   * caché (cache-aside).
   *
   * Con el servicio por defecto (CacheService) incluye:
   * - Coalescencia de llamadas concurrentes de la misma clave (una sola carga);
   * - stale-while-revalidate en modos con Redis (si `allowStale`);
   * - caché negativa con TTL corto para cargadores que devuelven `null`/`undefined`
   *   (solo en modos con Redis);
   * - protección contra avalanchas de carga (bloqueos distribuidos y límites de concurrencia).
   *
   * Con un adaptador custom (registrado vía CACHE_ADAPTER_TOKEN) que no exponga
   * `getOrLoad`, se emula el flujo básico get → cargador → set.
   *
   * @param key Clave de la caché.
   * @param loader Función que carga el valor desde la fuente de datos.
   * @param options Opciones por llamada (ttlSeconds, allowStale).
   * @returns El valor servido por la caché o cargado por el cargador.
   * @throws {Error} Si el cargador falla y no hay dato servible, el error se propaga.
   * @example
   * const user = await CacheManager.getOrLoad<User>("users:123", () =>
   *   userRepository.findById(123),
   * );
   */
  static async getOrLoad<T>(
    key: string,
    loader: () => Promise<T>,
    options?: CacheServiceGetOrLoadOptions,
  ): Promise<T> {
    const adapter = await getCacheAdapter();

    if (
      typeof (adapter as Partial<GetOrLoadCapable>).getOrLoad === "function"
    ) {
      return (adapter as unknown as GetOrLoadCapable).getOrLoad(
        key,
        loader,
        options,
      );
    }

    // Emulación para adaptadores personalizados (contrato de almacén, sin orquestación).
    const existing = await adapter.get<T>(key);
    if (existing) {
      return existing.value;
    }

    const value = await loader();
    const namespace = extractCacheNamespace(key);
    const namespaceVersion = await adapter.getVersion(namespace);
    const freshTtlMs =
      options?.ttlSeconds !== undefined && options.ttlSeconds > 0
        ? options.ttlSeconds * 1000
        : null;

    await adapter.set(
      key,
      createCacheEnvelope({
        value,
        namespaceVersion,
        freshTtlMs,
      }),
    );
    return value;
  }

  /**
   * @description Almacena un valor en la caché bajo una clave, con un TTL opcional.
   * @param key La clave única que identifica el valor.
   * @param value El valor a almacenar.
   * @param ttlSeconds TTL en segundos. Si no se provee o es <= 0, la entrada es
   * permanente (no expira).
   * @returns Una promesa que se resuelve cuando el valor queda almacenado.
   * @throws {Error} Si `ttlSeconds` no es finito o el adaptador rechaza la escritura.
   * @example
   * await CacheManager.set("users:123", user, 60);
   */
  static async set<T>(
    key: string,
    value: T,
    ttlSeconds?: number,
  ): Promise<void> {
    if (ttlSeconds !== undefined && !Number.isFinite(ttlSeconds)) {
      throw new Error(
        "[FastifyKit Cache] 'ttlSeconds' debe ser un número finito.",
      );
    }
    const adapter = await getCacheAdapter();
    const namespace = extractCacheNamespace(key);
    const namespaceVersion = await adapter.getVersion(namespace);

    const envelope = createCacheEnvelope<T>({
      value,
      namespaceVersion,
      freshTtlMs:
        ttlSeconds !== undefined && ttlSeconds > 0 ? ttlSeconds * 1000 : null,
    });

    await adapter.set(key, envelope);
  }

  /**
   * @description Elimina todas las claves cuyo namespace coincida (invalidación selectiva).
   * @param namespace El namespace a limpiar (primer segmento de la clave).
   * @returns Una promesa que se resuelve cuando termina la invalidación.
   * @throws {Error} Si el namespace es inválido o el adaptador rechaza la operación.
   * @example
   * await CacheManager.clearNamespace("users");
   */
  static async clearNamespace(namespace: string): Promise<void> {
    validateCacheNamespace(namespace);
    const adapter = await getCacheAdapter();
    await adapter.clearNamespace(namespace);
  }

  /**
   * @description Limpia toda la caché de la que el adaptador es dueño.
   * Nunca afecta datos de otras aplicaciones/prefijos.
   * @returns Una promesa que se resuelve cuando termina la limpieza.
   * @throws {Error} Si el adaptador no puede completar la limpieza.
   * @example
   * await CacheManager.clearAll();
   */
  static async clearAll(): Promise<void> {
    const adapter = await getCacheAdapter();
    await adapter.clearAll();
  }
}
