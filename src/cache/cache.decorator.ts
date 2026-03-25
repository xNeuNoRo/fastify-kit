import { CacheManager } from "../cache/CacheManager";

/**
 * @description Decorador para cachear el resultado de un método de clase.
 * El resultado se almacena en memoria durante un tiempo determinado (TTL)
 * y se recupera automáticamente en llamadas posteriores con los mismos argumentos.
 * @param namespace Un espacio de nombres para organizar las entradas de caché.
 * Esto es útil para evitar colisiones de claves y para permitir la invalidación selectiva de caché.
 * @param ttlSeconds El tiempo en segundos que el resultado del método debe permanecer en caché antes de ser considerado expirado.
 * @example
 * \@Cache("users", 60) // Cachea el resultado durante 60 segundos bajo el namespace "users"
 * getUserById(id: string) {
 *   // Lógica para obtener un usuario por ID, por ejemplo, una consulta a la base de datos
 * }
 * @returns Una función que envuelve el método original,
 * implementando la lógica de caché para almacenar y recuperar resultados según el namespace y TTL especificados.
 */
export function Cache(namespace: string, ttlSeconds?: number) {
  return function <This, Args extends any[], Return>(
    target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >,
  ) {
    if (context.kind !== "method") {
      throw new Error("@Cache solamente puede ser aplicado a métodos de clase");
    }

    // Se inicializa una sola vez cuando se carga la clase.
    // Inicia en 'true' si el desarrollador usó la palabra clave 'async'.
    let isPromiseMethod = target.constructor.name === "AsyncFunction";

    return function (this: This, ...args: Args): Return {
      const argsString = args.length ? JSON.stringify(args) : "[]";
      const key = `${namespace}:${String(context.name)}:${argsString}`;

      const cachedData = CacheManager.get<Return>(key);

      if (cachedData !== null) {
        // Si el método es una promesa, devolvemos una promesa resuelta con los datos en caché
        if (isPromiseMethod) {
          return Promise.resolve(cachedData) as Return;
        }
        return cachedData as Return;
      }

      const result = target.apply(this, args);

      if (result instanceof Promise) {
        isPromiseMethod = true;
        return result.then((data) => {
          CacheManager.set<Return>(key, data, ttlSeconds);
          return data;
        }) as Return;
      }

      CacheManager.set<Return>(key, result, ttlSeconds);
      return result;
    };
  };
}

/**
 * @description Decorador para limpiar la caché de un namespace específico.
 * @param namespace El espacio de nombres cuya caché se desea limpiar. Esto permite invalidar selectivamente los datos almacenados en caché relacionados con ese namespace.
 * @example
 * \@ClearCache("users") // Limpia toda la caché bajo el namespace "users"
 * updateUser(id: string, data: UpdateUserRequest) {
 *   // Lógica para actualizar un usuario, por ejemplo, una consulta a la base de datos
 * }
 * @returns Una función que envuelve el método original, ejecutando la lógica de limpieza de caché después de la ejecución del método.
 */
export function ClearCache(namespace: string) {
  return function <This, Args extends any[], Return>(
    target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >,
  ) {
    if (context.kind !== "method") {
      throw new Error(
        "@ClearCache solamente puede ser aplicado a métodos de clase",
      );
    }

    return function (this: This, ...args: Args): Return {
      const result = target.apply(this, args);

      if (result instanceof Promise) {
        return result.then((data) => {
          CacheManager.clearNamespace(namespace);
          return data;
        }) as Return;
      }

      CacheManager.clearNamespace(namespace);
      return result;
    };
  };
}
