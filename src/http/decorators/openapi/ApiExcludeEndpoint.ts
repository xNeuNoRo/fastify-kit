import type { FastifyKitMetadata } from "../types.js";

/**
 * @description Decorador de método para excluir un endpoint específico de la documentación
 * OpenAPI / Scalar. Útil para rutas internas, de debug o que no deben ser públicas.
 *
 * @returns Un decorador de método que marca el endpoint como excluido.
 *
 * @example
 * ```typescript
 * \@Controller("/users")
 * class UsersController {
 *   \@Get("/")
 *   getAll() { ... } // Documentado
 *
 *   \@Get("/internal/debug")
 *   \@ApiExcludeEndpoint()
 *   debugEndpoint() { ... } // No aparece en Scalar
 * }
 * ```
 */
export function ApiExcludeEndpoint() {
  return function <This, Args extends any[], Return>(
    _target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >,
  ) {
    if (context.kind !== "method") {
      throw new Error(
        "[FastifyKit] @ApiExcludeEndpoint solo puede aplicarse a métodos",
      );
    }

    const metadata = context.metadata as FastifyKitMetadata;
    metadata.openApiExcludeEndpoint ??= {};
    metadata.openApiExcludeEndpoint[context.name] = true;
  };
}
