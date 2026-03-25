import { AsyncLocalStorage } from "node:async_hooks";

export class AlsStore<T extends Record<string, any>> {
  private readonly als = new AsyncLocalStorage<Map<keyof T, any>>();

  /**
   * @description Ejecuta una función dentro del contexto de almacenamiento asíncrono, proporcionando un store específico para esa ejecución. Esto permite mantener datos relacionados con la solicitud a lo largo de toda la cadena de llamadas asíncronas sin necesidad de pasarlos explícitamente como argumentos.
   * @param store Un Map que contiene los datos que se desean almacenar en el contexto de la solicitud. Este map estará disponible para cualquier función que se ejecute dentro del callback proporcionado, permitiendo acceder a estos datos sin necesidad de pasarlos como argumentos.
   * @param callback Una función que se ejecutará dentro del contexto de almacenamiento asíncrono. Esta función puede ser síncrona o asíncrona, y tendrá acceso al store proporcionado a través del método getStore() del RequestContext.
   * @example
   * // Creamos una instancia de RequestContext con un tipo específico para el store
   * const requestContext = new RequestContext<Map<string, any>>();
   *
   * // Establecemos el contexto con un store que contiene un requestId
   * requestContext.run(new Map([["requestId", "12345"]]), () => {
   *   // Dentro de este callback, podemos acceder al store con getStore()
   *   const store = requestContext.getStore();
   *   console.log(store?.get("requestId")); // Imprime "12345"
   * });
   * @remarks El método run() es fundamental para establecer el contexto de la solicitud, y cualquier función que necesite acceder a los datos del store debe ser llamada dentro del callback proporcionado a run(). Si fuera en Express u Fastify, este método se llamaría dentro del middleware/handler/hook que maneja la solicitud, asegurando que el contexto esté disponible durante toda la vida de la solicitud.
   * @return El resultado de la función callback, que puede ser de cualquier tipo dependiendo de lo que retorne dicha función.
   */
  run<R>(store: Map<keyof T, any>, callback: () => R): R {
    return this.als.run(store, callback);
  }

  /**
   * @description Obtiene el store actual del contexto de almacenamiento asíncrono. Este método devuelve el map que se proporcionó al método run() para la ejecución actual, o undefined si no se ha establecido ningún contexto.
   * @example
   * // Creamos una instancia de RequestContext con un tipo específico para el store
   * const requestContext = new RequestContext<{ userId: string }>();
   *
   * // Establecemos el contexto con un store que contiene un userId
   * requestContext.run({ userId: "12345" }, () => {
   *   // Dentro de este callback, podemos acceder al store con getStore()
   *   const store = requestContext.getStore();
   *   console.log(store?.userId); // Imprime "12345"
   * });
   * @remarks El método getStore() es útil para acceder a los datos relacionados con la solicitud en cualquier parte del código que se ejecute dentro del contexto establecido por run(). Si se llama a getStore() fuera de ese contexto, devolverá undefined, por lo que es importante asegurarse de que cualquier función que necesite acceder al store se ejecute dentro del callback proporcionado a run().
   * @returns El map del store actual, o undefined si no se ha establecido ningún contexto. El tipo de este map es el mismo que se proporcionó al crear la instancia de RequestContext.
   */
  getStore(): Map<keyof T, any> | undefined {
    return this.als.getStore();
  }

  /**
   * @description Obtiene un valor específico del store actual utilizando una clave. Este método es una forma conveniente de acceder a propiedades individuales del store sin necesidad de obtener el map completo.
   * @param key La clave del valor que se desea obtener del store. Esta clave debe ser una propiedad del tipo T que se utilizó para crear la instancia de RequestContext.
   * @example
   * // Creamos una instancia de RequestContext con un tipo específico para el store
   * const requestContext = new RequestContext<{ userId: string; sessionId: string }>();
   *
   * // Establecemos el contexto con un store que contiene userId y sessionId
   * requestContext.run({ userId: "12345", sessionId: "abcde" }, () => {
   *   // Dentro de este callback, podemos acceder a valores específicos del store con get()
   *   const userId = requestContext.get("userId");
   *   console.log(userId); // Imprime "12345"
   * });
   * @remarks El método get() es útil para acceder directamente a valores específicos del store sin necesidad de manipular el map completo. Al igual que con getStore(), es importante asegurarse de que cualquier función que llame a get() se ejecute dentro del contexto establecido por run(), ya que de lo contrario devolverá undefined.
   * @returns El valor asociado a la clave proporcionada en el store actual, o undefined si no se ha establecido ningún contexto o si la clave no existe en el store. El tipo de este valor es el tipo de la propiedad correspondiente en T.
   */
  get<K extends keyof T>(key: K): T[K] | undefined {
    const store = this.als.getStore();
    return store ? store.get(key) : undefined;
  }

  /**
   * @description Obtiene un valor específico del store actual utilizando una clave, y lanza un error si el valor es undefined. Este método es útil para garantizar que se obtenga un valor válido del store, evitando así errores posteriores debido a valores undefined.
   * @param key La clave del valor que se desea obtener del store. Esta clave debe ser una propiedad del tipo T que se utilizó para crear la instancia de RequestContext.
   * @example
   * // Creamos una instancia de RequestContext con un tipo específico para el store
   * const requestContext = new RequestContext<{ userId: string; sessionId: string }>();
   *
   * // Establecemos el contexto con un store que contiene userId y sessionId
   * requestContext.run({ userId: "12345", sessionId: "abcde" }, () => {
   *   // Dentro de este callback, podemos acceder a valores específicos del store con getOrThrow()
   *   const userId = requestContext.getOrThrow("userId");
   *   console.log(userId); // Imprime "12345"
   * });
   * @remarks El método getOrThrow() es útil para acceder a valores específicos del store cuando se espera que esos valores siempre estén presentes. Si el valor asociado a la clave proporcionada es undefined, este método lanzará un error con un mensaje claro, lo que facilita la identificación de problemas relacionados con el contexto de la solicitud. Al igual que con los otros métodos, es importante asegurarse de que cualquier función que llame a getOrThrow() se ejecute dentro del contexto establecido por run(), ya que de lo contrario lanzará un error debido a la falta de contexto.
   * @returns El valor asociado a la clave proporcionada en el store actual. El tipo de este valor es el tipo de la propiedad correspondiente en T. Si el valor es undefined, se lanzará un error.
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
