import { getLogger } from "../logger/logger.factory.js";

/**
 * @description Decorador para medir el tiempo de ejecución de un método. Si el tiempo excede el umbral especificado, se registra una advertencia en el logger.
 * @param warnThresholdMs El umbral en milisegundos para registrar una advertencia si el método tarda más de lo esperado. Por defecto es 200ms.
 * @returns Un decorador de método que envuelve la función original y mide su tiempo de ejecución.
 * @example
 * class MyService {
 *   \@Benchmark(100) // Si este método tarda más de 100ms, se registrará una advertencia.
 *  async fetchData() {
 *     // Simula una operación que podría ser lenta
 *    await new Promise((resolve) => setTimeout(resolve, 150));
 *  }
 */
export function Benchmark(warnThresholdMs: number = 200) {
  return function <This, Args extends any[], Return>(
    target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >,
  ) {
    // Validamos que el decorador se aplique solo a métodos de clase
    if (context.kind !== "method") {
      throw new Error("@Benchmark solo puede ser aplicado a métodos de clase");
    }

    return function (this: This, ...args: Args): Return {
      // Registramos el tiempo de inicio antes de ejecutar la función original
      const start = performance.now();
      // Ejecutamos la función original
      const result = target.apply(this, args);

      // Función para calcular la duración y registrar una advertencia si excede el umbral
      const logIfSlow = (endTime: number) => {
        const duration = endTime - start;

        if (duration > warnThresholdMs) {
          const logger = getLogger();
          logger.warn(
            `[Benchmark] ${String(context.name)} tardo: ${duration.toFixed(2)}ms`,
            {
              durationMs: duration,
              method: String(context.name),
              threshold: warnThresholdMs,
            },
          );
        }
      };

      if (result instanceof Promise) {
        return result
          .then((res) => {
            logIfSlow(performance.now());
            return res;
          })
          .catch((err) => {
            logIfSlow(performance.now());
            throw err;
          }) as Return;
      }

      logIfSlow(performance.now());
      return result;
    };
  };
}
