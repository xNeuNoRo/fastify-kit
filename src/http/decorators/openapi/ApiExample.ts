/**
 * @description Símbolo único para almacenar ejemplos OpenAPI en una clase DTO/Modelo.
 * Se usa internamente para recolectar ejemplos definidos con \@ApiExample.
 */
export const OPENAPI_EXAMPLES_METADATA = Symbol.for(
  "fastifykit:openapi:examples",
);

/**
 * @description Decorador de clase para definir ejemplos de un DTO/Modelo en OpenAPI.
 * Los ejemplos aparecen en el dropdown de ejemplos en Scalar para cada endpoint
 * que use este DTO como respuesta.
 *
 * @param name Nombre único del ejemplo (ej: "adminUser", "newUser").
 * @param value El valor del ejemplo que se mostrará en Scalar.
 * @param summary Resumen opcional del ejemplo.
 * @param description Descripción opcional del ejemplo.
 * @returns Un decorador de clase que almacena el ejemplo en la metadata.
 *
 * @example
 * ```typescript
 * \@ApiSchema({ name: "User", description: "Entidad de usuario" })
 * \@ApiExample("adminUser", {
 *   id: 1,
 *   username: "admin",
 *   email: "admin@example.com",
 *   role: "admin"
 * })
 * \@ApiExample("newUser", {
 *   id: 2,
 *   username: "angel",
 *   email: "angel@example.com",
 *   role: "user"
 * }, "Usuario nuevo", "Ejemplo de un usuario recién creado")
 * class UserDto {
 *   id: number;
 *   username: string;
 *   email: string;
 *   role: string;
 * }
 * ```
 *
 * @remarks Se puede aplicar múltiples veces a la misma clase para proveer varios ejemplos.
 */
export function ApiExample(
  name: string,
  value: Record<string, unknown>,
  summary?: string,
  description?: string,
) {
  return function (
    target: Function,
    context: ClassDecoratorContext,
  ) {
    if (context.kind !== "class") {
      throw new Error(
        "[FastifyKit] @ApiExample solo puede aplicarse a clases",
      );
    }

    // Almacenamos los ejemplos directamente en el target (la clase)
    const cls = target as any;
    if (!cls[OPENAPI_EXAMPLES_METADATA]) {
      cls[OPENAPI_EXAMPLES_METADATA] = {};
    }
    cls[OPENAPI_EXAMPLES_METADATA][name] = {
      value,
      summary,
      description,
    };
  };
}
