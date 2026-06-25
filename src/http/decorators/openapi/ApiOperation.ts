import type { FastifyKitMetadata, ApiOperationOptions } from "../types.js";

/**
 * @description Decorador de método para documentar un endpoint en OpenAPI / Scalar.
 * Permite definir el resumen (summary), descripción larga (Markdown), si está deprecado,
 * documentación externa y un operationId personalizado.
 *
 * @param options Opciones de documentación para la operación.
 * @returns Un decorador de método que almacena la metadata de la operación en el controlador.
 *
 * @example
 * ```typescript
 * \@Controller("/users")
 * class UsersController {
 *   \@Get("/:id")
 *   \@ApiOperation({
 *     summary: "Obtener usuario por ID",
 *     description: "Retorna el perfil público del usuario, incluyendo nombre, email y rol.",
 *     externalDocs: { url: "https://docs.ejemplo.com/users#get" }
 *   })
 *   \@ApiResponse({ status: 200, description: "Usuario encontrado", type: UserDto })
 *   \@ApiResponse({ status: 404, description: "Usuario no encontrado" })
 *   getUser(@Param("id") id: string) { ... }
 * }
 * ```
 *
 * @remarks Si no se especifica operationId, FastifyKit generará uno automáticamente
 * basado en ControllerName_methodName (ej: "UsersController_getUser").
 */
export function ApiOperation(options: ApiOperationOptions) {
  return function <This, Args extends any[], Return>(
    _target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >,
  ) {
    if (context.kind !== "method") {
      throw new Error(
        "[FastifyKit] @ApiOperation solo puede aplicarse a métodos de clase",
      );
    }

    const metadata = context.metadata as FastifyKitMetadata;
    metadata.openApiOperation ??= {};
    metadata.openApiOperation[context.name] = options;
  };
}
