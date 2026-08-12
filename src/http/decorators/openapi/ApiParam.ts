import type { FastifyKitMetadata, ApiParamOptions } from "../types.js";

/**
 * @description Decorador de método para documentar un parámetro de ruta (path parameter)
 * en OpenAPI / Scalar. Agrega metadata como nombre, descripción, ejemplo, si es requerido
 * y si está deprecado.
 *
 * @param options Opciones del parámetro: name, description, example, required, deprecated.
 * @returns Un decorador de método que almacena la metadata del parámetro.
 *
 * @example
 * ```typescript
 * \@Controller("/users")
 * class UsersController {
 *   \@Get("/:id")
 *   \@ApiParam({ name: "id", description: "UUID del usuario", example: "550e8400-e29b-41d4-a716-446655440000", required: true })
 *   getUser(@Param("id") id: string) { ... }
 * }
 * ```
 *
 * @remarks Se puede aplicar múltiples veces para documentar varios path parameters.
 */
export function ApiParam(options: ApiParamOptions) {
  return function <This, Args extends any[], Return>(
    _target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >,
  ) {
    if (context.kind !== "method") {
      throw new Error(
        "[FastifyKit] @ApiParam solo puede aplicarse a métodos de clase",
      );
    }

    const metadata = context.metadata as FastifyKitMetadata;
    metadata.openApiParameters ??= {};

    if (!metadata.openApiParameters[context.name]) {
      metadata.openApiParameters[context.name] = [];
    }

    metadata.openApiParameters[context.name].unshift({
      in: "path",
      name: options.name,
      description: options.description,
      example: options.example,
      required: options.required ?? true,
      deprecated: options.deprecated,
    });
  };
}
