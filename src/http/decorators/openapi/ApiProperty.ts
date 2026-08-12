import type { ApiPropertyOptions } from "../types.js";

/**
 * @description Símbolo único para almacenar la metadata de propiedades de OpenAPI
 * en la clase del DTO/Modelo. Se usa internamente para recolectar las propiedades
 * decoradas con \@ApiProperty y generar el schema JSON correspondiente.
 */
export const OPENAPI_PROPERTY_METADATA = Symbol.for(
  "fastifykit:openapi:property",
);

/**
 * @description Decorador de propiedad para documentar un campo de un DTO/Modelo en OpenAPI.
 * Permite definir ejemplo, descripción, formato, restricciones de longitud/rango,
 * valores enum, si es nullable, deprecated, readOnly, writeOnly, y valor por defecto.
 *
 * @param options Opciones de documentación de la propiedad.
 * @returns Un decorador de propiedad (field) que almacena la metadata en la clase.
 *
 * @example
 * ```typescript
 * \@ApiSchema({ name: "User", description: "Entidad de usuario" })
 * class UserDto {
 *   \@ApiProperty({ example: 1, description: "ID único del usuario" })
 *   id: number;
 *
 *   \@ApiProperty({ example: "angel", description: "Nombre de usuario", minLength: 3, maxLength: 50 })
 *   username: string;
 *
 *   \@ApiProperty({ example: "angel@example.com", format: "email" })
 *   email: string;
 *
 *   \@ApiProperty({ enum: ["admin", "user", "moderator"], description: "Rol del usuario" })
 *   role: "admin" | "user" | "moderator";
 *
 *   \@ApiProperty({ description: "Contraseña (solo escritura)", writeOnly: true })
 *   password: string;
 *
 *   \@ApiProperty({ description: "Fecha de último acceso", format: "date-time", readOnly: true })
 *   lastLoginAt: string;
 *
 *   \@ApiProperty({ description: "¿Cuenta activa?", default: true })
 *   isActive: boolean;
 * }
 * ```
 *
 * @remarks Los decoradores de propiedad requieren que la clase esté decorada con \@ApiSchema
 * para que el registro automático en OpenApiRegistry funcione. Sin \@ApiSchema, las propiedades
 * se ignoran.
 */
export function ApiProperty(options: ApiPropertyOptions = {}) {
  return function (_target: undefined, context: ClassFieldDecoratorContext) {
    if (context.kind !== "field") {
      throw new Error(
        "[FastifyKit] @ApiProperty solo puede aplicarse a propiedades de clase",
      );
    }

    // Coleccionamos la metadata de propiedades en un Map estático de la clase
    const propertyName = String(context.name);

    // Usamos context.addInitializer para almacenar la metadata al momento
    // de la inicialización de la clase
    context.addInitializer(function (this: any) {
      const cls = this.constructor as any;
      if (!cls[OPENAPI_PROPERTY_METADATA]) {
        cls[OPENAPI_PROPERTY_METADATA] = {};
      }
      cls[OPENAPI_PROPERTY_METADATA][propertyName] = options;
    });
  };
}
