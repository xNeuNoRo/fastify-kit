import { CacheManager } from "./CacheManager.js";
import { CacheKeySerializationError } from "./errors.js";
import { validateCacheNamespace } from "./namespace.js";

const MAX_CACHE_KEY_LENGTH = 4096;

/**
 * @description Decorador para cachear el resultado de un método de clase.
 *
 * Desde la migración a la API asíncrona, el wrapper SIEMPRE retorna
 * una `Promise`. Por coherencia de tipos, el método decorado debe devolver
 * una `Promise` (declarado `async` o retornando `Promise` explícitamente);
 * los callers deben usar `await` sobre el método decorado. Un método declarado
 * síncrono devuelve igualmente una `Promise` en runtime.
 *
 * Semántica (delegada en `CacheManager.getOrLoad`):
 * - La clave se construye como `namespace:metodo:JSON(args)`.
 * - El resultado solo se almacena si el método resuelve correctamente;
 *   los errores se propagan sin cachearse.
 * - Los valores falsy (0, false, "") se cachean y devuelven correctamente.
 * - Llamadas concurrentes del mismo key con miss comparten una única ejecución.
 * - Con caché distribuida (modos con Redis): stale-while-revalidate si está
 *   permitido, y caché negativa (TTL corto) para métodos que devuelven
 *   `null`/`undefined`.
 *
 * @param namespace Espacio de nombres para organizar las entradas y permitir
 * invalidación selectiva.
 * @param ttlSeconds TTL en segundos. Si no se provee o es <= 0, la entrada es permanente.
 * @returns Un decorador de método que devuelve siempre una `Promise` en runtime.
 * @throws {Error} Si el namespace o `ttlSeconds` son inválidos.
 * @throws {CacheKeySerializationError} Si los argumentos no pueden formar una clave determinista.
 * @example
 * class UserService {
 *   \@Cache("users", 60)
 *   async getUserById(id: string) {
 *     return userRepository.findById(id);
 *   }
 * }
 */
export function Cache(namespace: string, ttlSeconds?: number) {
  validateCacheNamespace(namespace);
  if (ttlSeconds !== undefined && !Number.isFinite(ttlSeconds)) {
    throw new Error(
      "[FastifyKit Cache] 'ttlSeconds' debe ser un número finito.",
    );
  }
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

    return function (this: This, ...args: Args): Return {
      const argsString = serializeCacheArguments(args);
      const key = `${namespace}:${String(context.name)}:${argsString}`;
      if (key.length > MAX_CACHE_KEY_LENGTH) {
        throw new CacheKeySerializationError(
          `La clave de caché supera el límite de ${MAX_CACHE_KEY_LENGTH} caracteres.`,
        );
      }

      return CacheManager.getOrLoad<Awaited<Return>>(
        key,
        () =>
          Promise.resolve(target.apply(this, args)) as Promise<Awaited<Return>>,
        { ttlSeconds },
      ) as Return;
    };
  };
}

function serializeCacheArguments(args: unknown[]): string {
  const stack = new WeakSet<object>();
  try {
    return JSON.stringify(encodeCacheKeyValue(args, stack));
  } catch (error) {
    if (error instanceof CacheKeySerializationError) throw error;
    throw new CacheKeySerializationError(
      "Los argumentos del método no pueden serializarse para la clave de caché.",
      { cause: error },
    );
  }
}

function encodeCacheKeyValue(value: unknown, stack: WeakSet<object>): unknown {
  if (value === undefined) return { $type: "undefined" };
  if (value === null) return null;
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { $type: "number", value: "NaN" };
    if (value === Infinity) return { $type: "number", value: "Infinity" };
    if (value === -Infinity) return { $type: "number", value: "-Infinity" };
    if (Object.is(value, -0)) return { $type: "number", value: "-0" };
    return value;
  }
  if (typeof value === "bigint")
    return { $type: "bigint", value: String(value) };
  if (typeof value === "symbol")
    return { $type: "symbol", value: String(value) };
  if (typeof value === "function")
    return { $type: "function", value: value.name };
  if (value instanceof Date)
    return { $type: "date", value: value.toISOString() };
  if (typeof value !== "object") return value;
  if (stack.has(value)) {
    throw new CacheKeySerializationError(
      "Los argumentos del método contienen una referencia circular.",
    );
  }
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => encodeCacheKeyValue(item, stack));
    }
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, encodeCacheKeyValue(record[key], stack)]),
    );
  } finally {
    stack.delete(value);
  }
}

/**
 * @description Decorador para limpiar la caché de un namespace específico
 * DESPUÉS de que el método original resuelva correctamente.
 *
 * Si el método falla, la invalidación NO se ejecuta (los datos siguen servibles)
 * y el error se propaga.
 *
 * @param namespace El namespace cuya caché se desea invalidar.
 * @returns Un decorador de método que limpia el namespace después de una resolución correcta.
 * @throws {Error} Si la operación original o la invalidación fallan.
 * @example
 * class UserService {
 *   \@ClearCache("users")
 *   async updateUser(id: string, data: UpdateUserRequest) {
 *     return userRepository.update(id, data);
 *   }
 * }
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
      return (async () => {
        const result = await target.apply(this, args);
        await CacheManager.clearNamespace(namespace);
        return result;
      })() as Return;
    };
  };
}
