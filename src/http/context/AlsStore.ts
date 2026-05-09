import { AsyncLocalStorage } from "node:async_hooks";

export class AlsStore<T extends object> {
  // Ahora el AsyncLocalStorage guarda directamente el tipo genérico T (un objeto plano)
  private readonly als = new AsyncLocalStorage<T>();

  /**
   * @description Ejecuta una función dentro del contexto de almacenamiento asíncrono, proporcionando un store específico para esa ejecución. Esto permite mantener datos relacionados con la solicitud a lo largo de toda la cadena de llamadas asíncronas sin necesidad de pasarlos explícitamente como argumentos.
   * @param store Un objeto plano que contiene los datos que se desean almacenar en el contexto de la solicitud. Este objeto estará disponible para cualquier función que se ejecute dentro del callback proporcionado.
   * @param callback Una función que se ejecutará dentro del contexto de almacenamiento asíncrono. Esta función puede ser síncrona o asíncrona, y tendrá acceso al store proporcionado a través del método getStore().
   * @example
   * // Creamos una instancia de AlsStore con un tipo específico para el store
   * const requestContext = new AlsStore<{ requestId: string }>();
   *
   * // Establecemos el contexto con un store que contiene un requestId
   * requestContext.run({ requestId: "12345" }, () => {
   *    // Dentro de este callback, podemos acceder al store con getStore()
   *    const store = requestContext.getStore();
   *    console.log(store?.requestId); // Imprime "12345"
   * });
   * @return El resultado de la función callback, que puede ser de cualquier tipo dependiendo de lo que retorne dicha función.
   */
  run<R>(store: T, callback: () => R): R {
    return this.als.run(store, callback);
  }

  /**
   * @description Obtiene el store actual del contexto de almacenamiento asíncrono. Este método devuelve el objeto que se proporcionó al método run() para la ejecución actual, o undefined si no se ha establecido ningún contexto.
   * @returns El objeto del store actual, o undefined si no se ha establecido ningún contexto. El tipo de este objeto es el mismo que se proporcionó al crear la instancia de AlsStore.
   * @example
   * // Supongamos que tenemos una instancia de AlsStore con un tipo específico para el store
   * const requestContext = new AlsStore<{ requestId: string }>();
   *
   * // Establecemos el contexto con un store que contiene un requestId
   * requestContext.run({ requestId: "12345" }, () => {
   *    // Dentro de este callback, podemos obtener el store actual
   *    const store = requestContext.getStore();
   *    console.log(store?.requestId); // Imprime "12345"
   * });
   * // Fuera del contexto, getStore() devolverá undefined
   * const storeOutside = requestContext.getStore();
   * console.log(storeOutside); // Imprime undefined
   */
  getStore(): T | undefined {
    return this.als.getStore();
  }

  /**
   * @description Obtiene un valor específico del store actual utilizando una clave. Este método es una forma conveniente de acceder a propiedades individuales del store sin necesidad de obtener el objeto completo.
   * @param key La clave del valor que se desea obtener del store. Esta clave debe ser una propiedad del tipo T.
   * @returns El valor asociado a la clave proporcionada en el store actual, o undefined si no se ha establecido ningún contexto o si la clave no existe en el store.
   * @example
   * // Supongamos que tenemos un store con la forma { requestId: string, userId: number }
   * const requestContext = new AlsStore<{ requestId: string; userId: number }>();
   *
   * // Establecemos el contexto con un store que contiene requestId y userId
   * requestContext.run({ requestId: "12345", userId: 42 }, () => {
   *    // Podemos obtener valores individuales del store usando get()
   *    const requestId = requestContext.get("requestId");
   *    const userId = requestContext.get("userId");
   *    console.log(requestId); // Imprime "12345"
   *    console.log(userId); // Imprime 42
   * });
   */
  get<K extends keyof T>(key: K): T[K] | undefined {
    const store = this.als.getStore();
    return store ? store[key] : undefined;
  }

  /**
   * @description Establece o actualiza un valor específico en el store actual utilizando una clave. Es ideal para inyectar datos (como el usuario autenticado) a mitad del ciclo de vida de la solicitud.
   * @param key La clave de la propiedad que se desea establecer.
   * @param value El valor fuertemente tipado que se desea guardar.
   * @example
   * // Supongamos que tenemos un store con la forma { requestId: string, userId: number }
   * const requestContext = new AlsStore<{ requestId: string; userId: number }>();
   *
   * // Establecemos el contexto con un store que contiene solo el requestId
   * requestContext.run({ requestId: "12345", userId: 0 }, () => {
   *    // Más adelante en el ciclo de vida de la solicitud, podemos establecer el userId
   *    requestContext.set("userId", 42); // Actualiza el userId en el store actual
   *
   *    // Ahora podemos obtener el userId actualizado
   *    const userId = requestContext.get("userId");
   *    console.log(userId); // Imprime 42
   * });
   * @throws Si se intenta establecer un valor fuera del contexto de una solicitud
   * (es decir, cuando no hay un store activo), se lanzará un error indicando que no se puede establecer la propiedad.
   */
  set<K extends keyof T>(key: K, value: T[K]): void {
    const store = this.als.getStore();
    if (store) {
      store[key] = value;
    } else {
      throw new Error(
        `[RequestContext] Intentaste establecer la propiedad '${String(key)}' fuera del contexto de una solicitud.`,
      );
    }
  }

  /**
   * @description Obtiene un valor específico del store actual utilizando una clave, y lanza un error si el valor es undefined. Este método es útil para garantizar que se obtenga un valor válido del store, evitando así errores posteriores.
   * @param key La clave del valor que se desea obtener del store.
   * @returns El valor asociado a la clave proporcionada en el store actual. Si el valor es undefined o estamos fuera de contexto, se lanzará un error.
   * @throws Si el valor asociado a la clave es undefined o si no hay un contexto activo,
   * se lanzará un error indicando que se intentó acceder a una propiedad fuera de contexto o que el valor es undefined.
   * @example
   * // Supongamos que tenemos un store con la forma { requestId: string, userId: number }
   * const requestContext = new AlsStore<{ requestId: string; userId: number }>();
   *
   * // Establecemos el contexto con un store que contiene requestId y userId
   * requestContext.run({ requestId: "12345", userId: 42 }, () => {
   *    // Podemos obtener valores individuales del store usando getOrThrow()
   *    const requestId = requestContext.getOrThrow("requestId");
   *    const userId = requestContext.getOrThrow("userId");
   *    console.log(requestId); // Imprime "12345"
   *    console.log(userId); // Imprime 42
   * });
   */
  getOrThrow<K extends keyof T>(key: K): T[K] {
    const value = this.get(key);
    if (value === undefined) {
      throw new Error(
        `[RequestContext] Intentaste acceder a '${String(key)}' fuera de contexto o el valor es undefined.`,
      );
    }
    return value;
  }
}
