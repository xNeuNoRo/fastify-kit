/**
 * @description Función auxiliar para calcular el delay de reintento con backoff exponencial
 * @param baseDelayMs El delay base en milisegundos
 * @param attempt El número de intento actual (1 para el primer intento, 2 para el segundo, etc.)
 * @returns El delay calculado para el intento actual
 */
function getRetryDelay(baseDelayMs: number, attempt: number): number {
  return baseDelayMs * Math.pow(2, attempt - 1);
}

/**
 * @description Función auxiliar para crear una promesa que se resuelve después de un delay
 * @param delay El delay en milisegundos antes de resolver la promesa
 * @returns Una promesa que se resuelve después del delay especificado
 */
function sleep(delay: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

/**
 * @description Función auxiliar para ejecutar una función con reintentos y backoff
 * exponencial en caso de errores. Puede manejar tanto funciones síncronas como asíncronas.
 * @param execute La función a ejecutar, que puede ser síncrona o asíncrona
 * @param maxAttempts El número máximo de intentos antes de lanzar el error final
 * @param baseDelayMs El delay base en milisegundos para calcular el backoff exponencial
 * @param firstAttempt Una función opcional que se ejecutará en el primer intento, útil para manejar funciones asíncronas que devuelven una promesa
 * @returns El resultado de la función ejecutada, o una promesa que se resuelve con el resultado si la función es asíncrona
 */
async function executeAsyncWithRetry<Return>(
  execute: () => Return | Promise<Return>,
  maxAttempts: number,
  baseDelayMs: number,
  firstAttempt?: () => Return | Promise<Return>,
): Promise<Return> {
  let attempt = 0;
  let currentExecute = firstAttempt ?? execute;

  while (attempt < maxAttempts) {
    try {
      return await currentExecute();
    } catch (err) {
      attempt++;

      if (attempt >= maxAttempts) throw err;

      // Backoff exponencial: delay = baseDelayMs * 2^(attempt - 1)
      const delay = getRetryDelay(baseDelayMs, attempt);
      await sleep(delay);
      currentExecute = execute;
    }
  }

  throw new Error(
    "[UNREACHABLE]: No se completó la operación después de los reintentos",
  );
}

/**
 * @description Decorador de clase para aplicar reintentos con backoff exponencial a métodos de clase.
 * @param maxAttempts El número máximo de intentos antes de lanzar el error final (por defecto 3)
 * @param baseDelayMs El delay base en milisegundos para calcular el backoff exponencial (por defecto 1000 ms)
 * @example
 * class ApiService {
 *   \@Retry(5, 2000)
 *   async fetchData() {
 *     // Lógica para hacer una solicitud HTTP que podría fallar
 *   }
 * }
 * @returns Un decorador de método que envuelve la función original con lógica de reintentos y backoff exponencial
 * @throws Error si el decorador se aplica a algo que no es un método de clase
 */
export function Retry(maxAttempts: number = 3, baseDelayMs: number = 1000) {
  return function <This, Args extends any[], Return>(
    target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >,
  ) {
    if (context.kind !== "method") {
      throw new Error("@Retry solo puede ser aplicado a métodos de clase");
    }

    return function (this: This, ...args: Args): Return {
      const execute = () => target.apply(this, args);

      if (target.constructor.name === "AsyncFunction") {
        return executeAsyncWithRetry(
          execute,
          maxAttempts,
          baseDelayMs,
        ) as Return;
      }

      let attempt = 0;

      while (attempt < maxAttempts) {
        try {
          const result = execute();

          if (result instanceof Promise) {
            return executeAsyncWithRetry(
              execute,
              maxAttempts,
              baseDelayMs,
              () => result,
            ) as Return;
          }

          return result;
        } catch (err) {
          attempt++;
          if (attempt >= maxAttempts) throw err;
        }
      }

      throw new Error(
        "[UNREACHABLE]: No se completó la operación después de los reintentos",
      );
    };
  };
}
