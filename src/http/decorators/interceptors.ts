import type { Constructor } from "../routing/scanner/index.js";
import type { Interceptor } from "../interceptors/Interceptor.js";
import type { FastifyKitMetadata } from "./types.js";

/**
 * @description Decorador para aplicar interceptores a clases o métodos.
 * Permite registrar uno o varios interceptores que envolverán la ejecución de la ruta,
 * pudiendo mutar la petición, la respuesta, o manejar excepciones antes y después del controlador.
 * @param interceptors Uno o varios interceptores que implementan la interfaz Interceptor.
 * @example
 * ```typescript
 * @UseInterceptors(LoggingInterceptor, AuthInterceptor)
 * class UserController {
 *   @UseInterceptors(CacheInterceptor) // Este interceptor se aplicará solo a este método
 *   getUser() {
 *     // ...
 *   }
 * }
 * ```
 */
export function UseInterceptors(...interceptors: Constructor<Interceptor>[]) {
  return function (
    _target: Function,
    context: ClassDecoratorContext | ClassMethodDecoratorContext,
  ) {
    if (!context.metadata) return;

    const metadata = context.metadata as FastifyKitMetadata;

    // Si el decorador se aplica a una clase, registramos los interceptores a nivel global del controlador
    if (context.kind === "class") {
      metadata.classInterceptors = [
        ...(metadata.classInterceptors || []),
        ...interceptors,
      ];
    }
    // Si el decorador se aplica a un método, registramos los interceptores a nivel de ruta
    else if (context.kind === "method") {
      metadata.routeInterceptors ??= {};
      const handlerName = context.name;

      metadata.routeInterceptors[handlerName] = [
        ...(metadata.routeInterceptors[handlerName] || []),
        ...interceptors,
      ];
    }
    // Evitar que el decorador se aplique a otra cosa que no sea clase o método
    else {
      throw new Error(
        `[FastifyKit] @UseInterceptors solo puede aplicarse a clases o métodos.`,
      );
    }
  };
}
