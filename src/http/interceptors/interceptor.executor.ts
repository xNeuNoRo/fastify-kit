import type { ExecutionContext, Interceptor } from "./Interceptor.js";

export async function executeInterceptors(
  context: ExecutionContext,
  interceptors: Interceptor[],
  finalHandler: () => Promise<unknown>,
): Promise<unknown> {
  // Rastreamos el índice para evitar que un interceptor malicioso o con bugs
  // llame a `next.handle()` más de una vez y rompa el flujo o cause memory leaks.
  let index = -1;

  // Función recursiva que avanza al siguiente elemento en la cadena
  async function next(i: number): Promise<unknown> {
    if (i <= index) {
      throw new Error(
        "[FastifyKit] next.handle() fue llamado múltiples veces en un interceptor.",
      );
    }
    index = i;

    // Si llegamos al final de la cadena de interceptores,
    // ejecutamos el controlador real y devolvemos su resultado hacia arriba.
    if (i === interceptors.length) {
      return finalHandler();
    }

    // Tomamos el interceptor actual
    const interceptor = interceptors[i];

    // Lo ejecutamos inyectándole el contexto y el CallHandler.
    // El CallHandler es simplemente un puente (closure) que avanza al siguiente índice.
    return interceptor.intercept(context, {
      handle: () => next(i + 1),
    });
  }

  // Iniciamos la reacción en cadena desde el interceptor 0
  return next(0);
}
