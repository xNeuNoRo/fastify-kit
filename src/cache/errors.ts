/**
 * Error estable para consumidores que eligen `onRedisError: "fail"`.
 * El mensaje deliberadamente no incluye detalles del proveedor Redis.
 *
 * @example
 * // Requiere configurar `onRedisError: "fail"`.
 * try {
 *   await CacheManager.get("users:123");
 * } catch (error) {
 *   if (error instanceof CacheDependencyUnavailableError) {
 *     console.error(error.code, error.operation);
 *   }
 * }
 */
export class CacheDependencyUnavailableError extends Error {
  readonly code = "CACHE_DEPENDENCY_UNAVAILABLE" as const;
  readonly dependency = "redis" as const;
  readonly operation: string;

  /**
   * @param operation Operación de caché que no pudo completarse.
   * @param options Causa original opcional.
   */
  constructor(operation: string, options?: ErrorOptions) {
    super("La dependencia de caché no está disponible.", options);
    this.name = "CacheDependencyUnavailableError";
    this.operation = operation;
  }
}

/**
 * Error estable cuando el bulkhead de cargadores ha agotado su cola permitida.
 * Evita transformar una degradación de infraestructura en crecimiento ilimitado.
 *
 * @example
 * try {
 *   await CacheManager.getOrLoad("users:123", loadUser);
 * } catch (error) {
 *   if (error instanceof CacheLoadShedError) {
 *     // Aplicar un fallback o devolver una respuesta de saturación controlada.
 *   }
 * }
 */
export class CacheLoadShedError extends Error {
  readonly code = "CACHE_LOAD_SHED" as const;

  constructor() {
    super("La carga de caché fue rechazada por saturación controlada.");
    this.name = "CacheLoadShedError";
  }
}

/**
 * Error estable para mutaciones que no pudieron adquirir un fencing lock seguro.
 *
 * @example
 * try {
 *   await CacheManager.set("users:123", user, 60);
 * } catch (error) {
 *   if (error instanceof CacheMutationUnavailableError) {
 *     // Reintentar según la política de la aplicación.
 *   }
 * }
 */
export class CacheMutationUnavailableError extends Error {
  readonly code = "CACHE_MUTATION_UNAVAILABLE" as const;

  constructor() {
    super("La mutación de caché no pudo adquirir coordinación segura.");
    this.name = "CacheMutationUnavailableError";
  }
}

/**
 * Error estable para argumentos que no pueden formar una clave determinista.
 *
 * @example
 * try {
 *   await cachedService.load({ circular: objectWithCircularReference });
 * } catch (error) {
 *   if (error instanceof CacheKeySerializationError) {
 *     // Corregir los argumentos usados para construir la clave.
 *   }
 * }
 */
export class CacheKeySerializationError extends Error {
  readonly code = "CACHE_KEY_SERIALIZATION_FAILED" as const;

  /**
   * @param message Detalle de por qué no se pudo serializar la clave.
   * @param options Causa original opcional.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CacheKeySerializationError";
  }
}
