import type { FastifyKitMetadata, ApiSchemaOptions } from "../types.js";
import type { Constructor } from "../../routing/scanner/index.js";

/**
 * @description Decorador de clase para registrar un DTO/Modelo como esquema reutilizable
 * en OpenAPI 3.1. Los esquemas registrados aparecen en `components/schemas` y pueden
 * ser referenciados por `$ref` desde respuestas, parámetros y otros esquemas.
 *
 * @param options Opciones del esquema: name, description, deprecated, y composición (oneOf, anyOf, allOf, discriminator).
 * @returns Un decorador de clase que registra el esquema en la metadata.
 *
 * @example
 * ```typescript
 * \@ApiSchema({ name: "User", description: "Entidad de usuario del sistema" })
 * class UserDto {
 *   \@ApiProperty({ example: 1 })
 *   id: number;
 *
 *   \@ApiProperty({ example: "angel", minLength: 3 })
 *   username: string;
 * }
 *
 * // Polimorfismo con discriminador:
 * \@ApiSchema({
 *   name: "Animal",
 *   oneOf: [CatDto, DogDto],
 *   discriminator: { propertyName: "type", mapping: { cat: "#/components/schemas/Cat", dog: "#/components/schemas/Dog" } }
 * })
 * abstract class AnimalDto {
 *   \@ApiProperty({ enum: ["cat", "dog"] })
 *   type: "cat" | "dog";
 * }
 * ```
 *
 * @remarks Este decorador es la llave para el registro automático en el OpenApiRegistry.
 * Sin él, la clase no se registra como componente reutilizable aunque tenga \@ApiProperty.
 */
export function ApiSchema(options: ApiSchemaOptions) {
  return function <T, Args extends any[]>(
    _target: Constructor<T>,
    context: ClassDecoratorContext<new (...args: Args) => T>,
  ) {
    if (context.kind !== "class") {
      throw new Error(
        "[FastifyKit] @ApiSchema solo puede aplicarse a clases",
      );
    }

    const metadata = context.metadata as FastifyKitMetadata;
    metadata.openApiSchema = options;
  };
}
