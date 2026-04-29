import type { TSchema } from "@sinclair/typebox";
import type { FastifyKitMetadata } from "./types.js";
import { createApiResponseSchema } from "../responses/api-response.schema.js";

/**
 * @description Decorador para definir el esquema de serialización de la respuesta de un método en un controlador.
 * @param schema Esquema de TypeBox que define la estructura de los datos que se devolverán al cliente.
 * @param statusCode Código HTTP que se asociará con este esquema de respuesta. Por defecto es 200, pero se puede configurar para otros códigos como 201, 400, 500, etc., dependiendo del caso de uso.
 * @returns Un decorador de método que agrega la metadata necesaria para que FastifyKit pueda aplicar la serialización de la respuesta según el esquema definido.
 * @example
 * ```typescript
 * \@Controller("/users")
 * class UserController {
 *   \@Get("/:id")
 *   \@Serialize(UserResponseSchema) // Aquí aplicamos el decorador de serialización
 *   \@UseParams(Param("id"))
 *   getUser(id: string) {
 *     // Lógica para obtener el usuario por ID
 *     return user; // El resultado se serializará según UserResponseSchema antes de enviarse al cliente
 *   }
 * }
 * ```
 */
export function Serialize(schema: TSchema, statusCode: number = 200) {
  return function <This, Args extends any[], Return>(
    _target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >,
  ) {
    if (context.kind !== "method") {
      throw new Error("@Serialize solo puede ser aplicado a métodos de clase");
    }

    const metadata = context.metadata as FastifyKitMetadata;

    // Inicializamos el diccionario global de respuestas si no existe
    metadata.responsesSchema ??= {};

    // Inicializamos el diccionario específico para este método si no existe
    if (!metadata.responsesSchema[context.name]) {
      metadata.responsesSchema[context.name] = {};
    }

    // Guardamos el esquema
    metadata.responsesSchema[context.name][statusCode] =
      createApiResponseSchema(schema);
  };
}
