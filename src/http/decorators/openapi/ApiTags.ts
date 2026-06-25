import type { FastifyKitMetadata } from "../types.js";

/**
 * @description Decorador de clase para agrupar endpoints bajo uno o varios tags en la documentación
 * OpenAPI / Scalar. Los tags permiten organizar visualmente los endpoints en la UI de Scalar,
 * colapsando las rutas bajo encabezados como "Users", "Auth", "Products", etc.
 *
 * @param tags Nombres de los tags a aplicar. Puedes pasar uno o varios strings.
 * @returns Un decorador de clase que almacena los tags en la metadata OpenAPI del controlador.
 *
 * @example
 * ```typescript
 * \@ApiTags("Users", "Admin")
 * \@Controller("/users")
 * class UsersController {
 *   \@Get("/profile")
 *   getProfile() { ... }
 * }
 * ```
 *
 * @remarks Los tags se heredan hacia todos los métodos del controlador. Si un método tiene
 * tags adicionales mediante otro decorador, estos se combinarán.
 */
export function ApiTags(...tags: string[]) {
  return function <T, Args extends any[]>(
    _target: new (...args: Args) => T,
    context: ClassDecoratorContext<new (...args: Args) => T>,
  ) {
    if (context.kind !== "class") {
      throw new Error("[FastifyKit] @ApiTags solo puede aplicarse a clases");
    }

    const metadata = context.metadata as FastifyKitMetadata;
    metadata.openApiTags = tags;
  };
}
