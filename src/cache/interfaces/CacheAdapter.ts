/**
 * @description Token de inyección de dependencias para el adaptador de caché.
 * Cualquier backend de caché que se integre con FastifyKit debe registrarse
 * en el contenedor de inyección de dependencias utilizando este token.
 */
export const CACHE_ADAPTER_TOKEN = Symbol.for("CACHE_ADAPTER");

/**
 * @description Envelope persistido de una entrada de caché.
 *
 * Contiene únicamente los datos necesarios para resolver el estado de la entrada:
 * - `freshUntil`: fin de la ventana "fresh". `null` significa que nunca expira.
 * - `staleUntil`: fin de la vida total servible (fresh + stale). `null` significa
 *   que no hay ventana stale; si `freshUntil` también es `null`, la entrada es permanente.
 *
 * La frescura NO se persiste: se calcula al leer comparando las marcas de tiempo con
 * el reloj actual, para que un envelope nunca quede obsoleto en su propio flag.
 */
export interface CacheEnvelope<T = unknown> {
  /** Valor almacenado. */
  value: T;
  /** Versión del namespace en el momento de la escritura (control de coherencia). */
  namespaceVersion: number;
  /** Momento de la escritura (epoch ms). */
  storedAt: number;
  /** Fin de la ventana "fresh" (epoch ms) o `null` si la entrada es permanente. */
  freshUntil: number | null;
  /** Fin de la ventana "stale" (epoch ms) o `null` si no hay ventana stale. */
  staleUntil: number | null;
  /** `true` si la entrada es caché negativa (resultado vacío/404). */
  isNegative: boolean;
}

/**
 * @description Contrato de un almacén de caché (capa L1 o L2).
 *
 * Un adaptador es un ALMACÉN: solo persiste y recupera envelopes. NO ejecuta el cargador,
 * NO decide políticas de frescura ni coordina invalidaciones. Esa orquestación pertenece
 * al servicio de caché (CacheService), que recibe el cargador del decorador o del código llamador.
 *
 * Garantías del contrato:
 * - `get` nunca devuelve envelopes "expirados": los elimina perezosamente y retorna `null`.
 * - `getVersion` retorna `0` si el namespace aún no tiene versión.
 * - `clearAll` limpia únicamente las claves de las que este almacén es dueño
 *   (en L2, las que comparten su `keyPrefix`); nunca ejecuta FLUSHALL.
 *
 * @example
 * const entry = await adapter.get<User>("users:123");
 * if (entry !== null) {
 *   console.log(entry.value);
 * }
 */
export interface CacheAdapter {
  /**
   * @description Obtiene el envelope de una clave, o `null` si no existe o está expirado.
   * @param key Clave de la entrada.
   * @returns El envelope almacenado o `null` si no es servible.
   */
  get<T>(key: string): Promise<CacheEnvelope<T> | null>;

  /**
   * @description Persiste un envelope bajo una clave.
   * @param key Clave de la entrada.
   * @param envelope Envelope completo que se almacenará.
   * @returns Una promesa que se resuelve cuando termina la escritura.
   */
  set<T>(key: string, envelope: CacheEnvelope<T>): Promise<void>;

  /**
   * @description Elimina una clave del almacén.
   * @param key Clave de la entrada.
   * @returns Una promesa que se resuelve cuando termina la eliminación.
   */
  delete(key: string): Promise<void>;

  /**
   * @description Elimina todas las claves cuyo namespace coincida.
   * @param namespace El namespace a limpiar (primer segmento de la clave).
   * @returns Una promesa que se resuelve cuando termina la invalidación.
   */
  clearNamespace(namespace: string): Promise<void>;

  /**
   * @description Elimina todas las claves de las que este almacén es dueño.
   * Nunca afecta datos de otros prefijos/aplicaciones.
   * @returns Una promesa que se resuelve cuando termina la limpieza.
   */
  clearAll(): Promise<void>;

  /**
   * Limpia entradas sin modificar generaciones, para recuperación de una capa local.
   * @returns Una promesa que se resuelve cuando se eliminan las entradas.
   */
  clearEntries?(): Promise<void>;

  /**
   * @description Obtiene la versión actual de un namespace.
   * Se usa para detectar entradas obsoletas tras invalidaciones (incremento de versión).
   * @param namespace Namespace cuya versión se consulta.
   * @returns La versión actual, o `0` si el namespace nunca fue versionado.
   */
  getVersion(namespace: string): Promise<number>;

  /**
   * @description Sincroniza la versión de un namespace con un valor externo.
   * Se usa al recibir invalidaciones distribuidas para alinear la coherencia local
   * con la versión remota (una entrada escrita con una versión anterior queda obsoleta).
   * Los stores locales la aplican de forma MONOTÓNICA: nunca bajan la versión,
   * para tolerar mensajes fuera de orden.
   * @param namespace Namespace a sincronizar.
   * @param version Versión a aplicar.
   * @returns Una promesa que se resuelve cuando la versión queda sincronizada.
   */
  setVersion(namespace: string, version: number): Promise<void>;

  /**
   * @description Cierra los recursos de la capa (conexiones, timers, suscriptores).
   * Implementación opcional: L1 no necesita hacer nada; L2 cierra su suscriptor dedicado.
   * @returns Una promesa que se resuelve cuando los recursos quedan cerrados.
   */
  close?(): Promise<void>;
}
