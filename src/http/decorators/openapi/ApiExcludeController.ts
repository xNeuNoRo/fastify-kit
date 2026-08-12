import type { FastifyKitMetadata } from "../types.js";

/**
 * @description Decorador de clase para excluir un controlador completo de la documentación
 * OpenAPI / Scalar. Todos los endpoints del controlador se ocultan de la UI de Scalar
 * y del spec JSON generado.
 *
 * @returns Un decorador de clase que marca el controlador como excluido.
 *
 * @example
 * ```typescript
 * \@Controller("/internal")
 * \@ApiExcludeController()
 * class InternalController {
 *   \@Get("/health-check")
 *   check() { ... } // No aparece en Scalar
 *
 *   \@Get("/debug")
 *   debug() { ... } // No aparece en Scalar
 * }
 * ```
 *
 * @remarks Útil para controladores de administración interna, health checks con interfaz propia,
 * o endpoints de depuración que no deben figurar en la documentación pública.
 */
export function ApiExcludeController() {
  return function <T, Args extends any[]>(
    _target: new (...args: Args) => T,
    context: ClassDecoratorContext<new (...args: Args) => T>,
  ) {
    if (context.kind !== "class") {
      throw new Error(
        "[FastifyKit] @ApiExcludeController solo puede aplicarse a clases",
      );
    }

    const metadata = context.metadata as FastifyKitMetadata;
    metadata.openApiExcludeController = true;
  };
}
