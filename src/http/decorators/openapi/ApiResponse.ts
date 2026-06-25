import type { FastifyKitMetadata, ApiResponseOptions } from "../types.js";

/**
 * @description Decorador de método para documentar una posible respuesta HTTP de un endpoint
 * en OpenAPI / Scalar. Se puede aplicar múltiples veces para documentar distintos códigos
 * de estado (200, 201, 400, 401, 404, 500, etc.).
 *
 * @param options Opciones de la respuesta: status, description, type (DTO), headers, links.
 * @returns Un decorador de método que almacena la metadata de la respuesta en el controlador.
 *
 * @example
 * ```typescript
 * \@Controller("/users")
 * class UsersController {
 *   \@Post("/")
 *   \@ApiResponseDoc({ status: 201, description: "Usuario creado exitosamente", type: UserDto })
 *   \@ApiResponseDoc({ status: 400, description: "Datos inválidos" })
 *   \@ApiResponseDoc({ status: 409, description: "El email ya existe" })
 *   createUser(@Body() body: CreateUserDto) { ... }
 * }
 * ```
 *
 * @remarks Se puede combinar con \@Serialize para que el schema de la respuesta exitosa
 * se genere automáticamente desde TypeBox. \@ApiResponseDoc agrega la descripción y metadatos
 * adicionales (headers, links, contentType).
 */
export function ApiResponseDoc(options: ApiResponseOptions) {
  return function <This, Args extends any[], Return>(
    _target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >,
  ) {
    if (context.kind !== "method") {
      throw new Error(
        "[FastifyKit] @ApiResponseDoc solo puede aplicarse a métodos de clase",
      );
    }

    const metadata = context.metadata as FastifyKitMetadata;
    metadata.openApiResponseMetas ??= {};

    if (!metadata.openApiResponseMetas[context.name]) {
      metadata.openApiResponseMetas[context.name] = {};
    }

    metadata.openApiResponseMetas[context.name][options.status] = options;
  };
}
