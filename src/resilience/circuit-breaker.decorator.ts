import { getLogger } from "../logger/logger.factory";

// Los estados son:
// - CLOSED: Quiere decir que esta funciionando correctamente,
// las peticiones se ejecutan normalmente.
// - OPEN: Quiere decir que el circuito se ha abierto debido
// a un número excesivo de fallos. En este estado,
// las peticiones no se ejecutan y se devuelve un error inmediatamente.
// - HALF_OPEN: Después de un período de tiempo, el circuito intenta cerrarse nuevamente.
// En este estado, se permite que algunas peticiones pasen para probar si el problema
// se ha resuelto. Si las peticiones tienen éxito, el circuito se cierra; si fallan, vuelve a abrirse.
enum CircuitState {
  CLOSED,
  OPEN,
  HALF_OPEN,
}

/**
 * @description El decorador @CircuitBreaker se utiliza para aplicar el patrón de diseño "Circuit Breaker" a
 * métodos de clase que realizan operaciones propensas a fallos, como llamadas a servicios externos o bases de datos.
 * Este patrón ayuda a mejorar la resiliencia de la aplicación al evitar que se realicen llamadas repetidas a un
 * servicio que está fallando, lo que puede ayudar a prevenir una cascada de fallos en toda la aplicación.
 * @param failureThreshold El número de fallos consecutivos que se permiten antes de abrir el circuito. Por defecto, es 3.
 * @param resetTimeoutMs El tiempo en milisegundos que el circuito permanecerá abierto antes de intentar medio abrirlo para probar si el servicio se ha recuperado. Por defecto, es 30000 ms (30 segundos).
 * @example
 * \@CircuitBreaker(5, 60000) // Abre el circuito después de 5 fallos y lo mantiene abierto durante 60 segundos
 * async fetchData() {
 *   // Lógica para llamar a un servicio externo o base de datos
 * }
 * @returns Una función que envuelve el método decorado, implementando la lógica del circuito breaker para controlar el flujo de ejecución basado en el estado del circuito y el número de fallos.
 */
export function CircuitBreaker(
  failureThreshold: number = 3,
  resetTimeoutMs: number = 30000,
) {
  return function <This, Args extends any[], Return>(
    target: (this: This, ...args: Args) => Promise<Return>,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Promise<Return>
    >,
  ) {
    if (context.kind !== "method") {
      throw new Error(
        "@CircuitBreaker solo puede ser aplicado a métodos de clase",
      );
    }

    // El estado del circuito, el conteo de fallos y el tiempo para el próximo intento se mantienen como un estado local para cada método decorado.
    let state = CircuitState.CLOSED;
    let failures = 0;
    let nextAttemptTime = 0;

    return async function (this: This, ...args: Args): Promise<Return> {
      const logger = getLogger();
      const now = Date.now();

      if (state === CircuitState.OPEN) {
        if (now >= nextAttemptTime) {
          // Si ya paso el tiempo de "castigo", intentamos medio abrir el circuito para probar si el servicio se ha recuperado
          state = CircuitState.HALF_OPEN;
          logger.warn(
            `🟡 [CircuitBreaker] Probando conexión en '${String(context.name)}' (HALF_OPEN)...`,
          );
        } else {
          // Aún estamos en periodo de "castigo", rechazamos la petición inmediatamente
          const timeLeft = Math.ceil((nextAttemptTime - now) / 1000);
          throw new Error(
            `🚫 [CircuitBreaker] Circuito ABIERTO en '${String(context.name)}'. Reintentar en ${timeLeft}s.`,
          );
        }
      }

      try {
        const result = await target.apply(this, args);

        // Si la petición fue exitosa y estábamos en HALF_OPEN, cerramos el circuito y reiniciamos el conteo de fallos
        if (state === CircuitState.HALF_OPEN) {
          state = CircuitState.CLOSED;
          failures = 0;
          logger.info(
            `🟢 [CircuitBreaker] Servicio restaurado en '${String(context.name)}' (CLOSED).`,
          );
        }

        return result;
      } catch (err) {
        failures++;

        // Si estamos en HALF_OPEN o hemos alcanzado el umbral de fallos, abrimos el circuito y establecemos el tiempo para el próximo intento
        if (state === CircuitState.HALF_OPEN || failures >= failureThreshold) {
          state = CircuitState.OPEN;
          nextAttemptTime = Date.now() + resetTimeoutMs;
          logger.error(
            `🔴 [CircuitBreaker] Circuito ABIERTO en '${String(context.name)}' tras ${failures} fallos. Bloqueando por ${resetTimeoutMs / 1000}s.`,
          );
        }

        // Propagamos el error original para que el metodo decorado pueda manejarlo
        throw err;
      }
    };
  };
}
