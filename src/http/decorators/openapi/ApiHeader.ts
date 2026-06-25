import type { FastifyKitMetadata, ApiHeaderOptions } from "../types.js";

/**
 * @description Decorador de método para documentar un header de la request en OpenAPI / Scalar.
 * Útil para headers personalizados como `X-Request-ID`, `Accept-Language`, `X-API-Key`, etc.
 *
 * @param options Opciones del header: name, description, example, required, deprecated.
 * @returns Un decorador de método que almacena la metadata del header.
 *
 * @example
 * ```typescript
 * \@Controller("/users")
 * class UsersController {
 *   \@Get("/")
 *   \@ApiHeader({ name: "X-Request-ID", description: "ID de trazabilidad", example: "req-abc123" })
 *   \@ApiHeader({ name: "Accept-Language", description: "Idioma preferido", example: "es-MX" })
 *   getAll(@Headers("x-request-id") requestId?: string) { ... }
 * }
 * ```
 */
export function ApiHeader(options: ApiHeaderOptions) {
  return function <This, Args extends any[], Return>(
    _target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >,
  ) {
    if (context.kind !== "method") {
      throw new Error(
        "[FastifyKit] @ApiHeader solo puede aplicarse a métodos de clase",
      );
    }

    const metadata = context.metadata as FastifyKitMetadata;
    metadata.openApiParameters ??= {};

    if (!metadata.openApiParameters[context.name]) {
      metadata.openApiParameters[context.name] = [];
    }

    metadata.openApiParameters[context.name].unshift({
      in: "header",
      name: options.name,
      description: options.description,
      example: options.example,
      required: options.required,
      deprecated: options.deprecated,
    });
  };
}
