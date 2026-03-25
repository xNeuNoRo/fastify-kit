type CacheEntry<T> = {
  expires: number | null; // null significa que no expira
  data: T;
};

export class CacheManager {
  private static readonly store = new Map<string, CacheEntry<unknown>>();

  /**
   * @description Obtiene un valor de la caché por su clave. Si el valor existe y no ha expirado, se devuelve; de lo contrario, se retorna null.
   * @param key La clave única que identifica el valor almacenado en caché. Esta clave suele construirse a partir del namespace, el nombre del método y los argumentos para garantizar su unicidad.
   * @example
   * const userId = "123";
   * const cacheKey = `users:getUser:${userId}`;
   * const cachedUser = CacheManager.get<User>(cacheKey);
   * if (cachedUser) {
   *   // Usar los datos en caché
   * } else {
   *   // Realizar la consulta a la base de datos y luego almacenar el resultado en caché
   * }
   * @returns El valor almacenado en caché si existe y es válido, o null si no se encuentra o ha expirado. El tipo de retorno es genérico para permitir flexibilidad en el tipo de datos almacenados.
   */
  static get<T>(key: string): T | null {
    const cached = this.store.get(key);

    if (!cached) {
      return null;
    }

    if (cached.expires === null || cached.expires > Date.now()) {
      return cached.data as T;
    }

    this.store.delete(key);
    return null;
  }

  /**
   * @description Almacena un valor en la caché bajo una clave específica, con una opción de tiempo de vida (TTL) para controlar su expiración.
   * @param key La clave única que identifica el valor a almacenar en caché.
   * @param data El valor que se desea almacenar en caché. El tipo es genérico para permitir cualquier tipo de dato.
   * @example
   * const userId = "123";
   * const cacheKey = `users:getUser:${userId}`;
   * const userData = { id: userId, name: "John Doe" };
   * CacheManager.set<User>(cacheKey, userData, 60); // Almacena el usuario en caché durante 60 segundos
   * @remarks Si ttlSeconds no se proporciona o es menor o igual a cero, el valor se almacenará sin fecha de expiración, lo que significa que permanecerá en caché indefinidamente hasta que sea eliminado manualmente o por alguna lógica de limpieza.
   * @param ttlSeconds Opcional. El tiempo en segundos que el valor debe permanecer en caché antes de ser considerado expirado. Si no se proporciona o es menor o igual a cero, el valor se almacenará sin fecha de expiración (permanente).
   */
  static set<T>(key: string, data: T, ttlSeconds?: number): void {
    const expires =
      ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { expires, data });
  }

  /**
   * @description Elimina un valor específico de la caché utilizando su clave. Esto es útil para invalidar datos que ya no son relevantes o que han sido actualizados.
   * @param namespace El espacio de nombres al que pertenece la clave que se desea eliminar. Esto ayuda a organizar y gestionar la caché de manera más eficiente.
   * @example
   * const userId = "123";
   * const cacheKey = `users:getUser:${userId}`;
   * CacheManager.delete(cacheKey); // Elimina el usuario específico de la caché
   */
  static clearNamespace(namespace: string): void {
    const prefix = `${namespace}:`;

    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  /**
   * @description Limpia toda la caché almacenada, eliminando todas las entradas sin importar su namespace.
   * Esto es útil para reiniciar completamente el estado de la caché, por ejemplo, durante un despliegue o una actualización importante.
   */
  static clearAll(): void {
    this.store.clear();
  }
}
