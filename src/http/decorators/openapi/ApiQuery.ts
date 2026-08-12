import type { FastifyKitMetadata, ApiQueryOptions } from "../types.js";

/**
 * @description Decorador de método para documentar un query parameter en OpenAPI / Scalar.
 * Permite especificar nombre, descripción, ejemplo, si es requerido, estilo de serialización
 * y si usa explode para arrays/objetos.
 *
 * @param options Opciones del query parameter.
 * @returns Un decorador de método que almacena la metadata del parámetro.
 *
 * @example
 * ```typescript
 * \@Controller("/users")
 * class UsersController {
 *   \@Get("/")
 *   \@ApiQuery({ name: "page", description: "Número de página", example: 1 })
 *   \@ApiQuery({ name: "limit", description: "Resultados por página", example: 20, required: true })
 *   \@ApiQuery({ name: "sort", description: "Campo de ordenamiento", example: "createdAt", deprecated: true })
 *   getAll(@Query("page") page?: number, @Query("limit") limit?: number) { ... }
 * }
 * ```
 *
 * @remarks Se puede aplicar múltiples veces para documentar varios query parameters.
 * El estilo de serialización por defecto es "form" con explode: true para arrays.
 */
export function ApiQuery(options: ApiQueryOptions) {
  return function <This, Args extends any[], Return>(
    _target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >,
  ) {
    if (context.kind !== "method") {
      throw new Error(
        "[FastifyKit] @ApiQuery solo puede aplicarse a métodos de clase",
      );
    }

    const metadata = context.metadata as FastifyKitMetadata;
    metadata.openApiParameters ??= {};

    if (!metadata.openApiParameters[context.name]) {
      metadata.openApiParameters[context.name] = [];
    }

    metadata.openApiParameters[context.name].unshift({
      in: "query",
      name: options.name,
      description: options.description,
      example: options.example,
      required: options.required,
      deprecated: options.deprecated,
      style: options.style,
      explode: options.explode,
    });
  };
}
