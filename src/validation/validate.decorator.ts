import { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { getLogger } from "../logger/logger.factory";
import { ValidationException } from "../http/exceptions";

/**
 * @description Decorador de método para validar los argumentos de una función utilizando un esquema de TypeBox. Este decorador intercepta la llamada al método, valida el argumento especificado contra el esquema proporcionado y lanza una excepción si la validación falla. Es especialmente útil para validar datos de entrada en controladores o servicios.
 * @param schema El esquema de TypeBox que define la estructura y las reglas de validación para el argumento que se desea validar. Este esquema puede incluir tipos, propiedades requeridas, formatos, etc.
 * @param argIndex El índice del argumento que se desea validar. Por defecto, se valida el primer argumento (índice 0), pero se puede especificar cualquier otro índice si el método tiene múltiples argumentos y se desea validar uno específico.
 * @returns Una función que envuelve el método original, realizando la validación antes de ejecutar la lógica del método. Si la validación falla, se lanza una ValidationException con detalles sobre los errores encontrados.
 * @example
 * // Supongamos que tenemos un controlador con un método que recibe un objeto de usuario y queremos validar su estructura utilizando \@Validate:
 * import { Type } from "@sinclair/typebox";
 *
 * const UserSchema = Type.Object({
 *   name: Type.String(),
 *   email: Type.String({ format: "email" }),
 *   age: Type.Optional(Type.Number({ minimum: 0 })),
 * });
 *
 * class UserController {
 *   \@Validate(UserSchema)
 *   createUser(userData: any) {
 *     // Si userData no cumple con UserSchema, se lanzará una ValidationException antes de ejecutar esta lógica
 *     console.log("Usuario creado:", userData);
 *   }
 * }
 * @remarks Este decorador es agnóstico al tipo de datos que se está validando, siempre y cuando se proporcione un esquema de TypeBox adecuado. Además, la excepción lanzada en caso de validación fallida incluye detalles sobre los errores encontrados, lo que facilita la depuración y el manejo de errores en la aplicación.
 */
export function Validate(schema: TSchema, argIndex: number = 0) {
  return function <This, Args extends any[], Return>(
    target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >,
  ) {
    if (context.kind !== "method") {
      throw new Error("@Validate solo puede ser aplicado a métodos de clase");
    }

    return function (this: This, ...args: Args): Return {
      const logger = getLogger();
      const dataToValidate = args[argIndex];

      // Si el argumento a validar no está presente, lanzamos un error específico para facilitar la depuración
      if (dataToValidate === undefined) {
        const errorMsg = `[Validate]: Falta el argumento en la posición ${argIndex} para el método '${String(context.name)}'`;
        logger.error(`🔴 ${errorMsg}`);
        throw new Error(errorMsg);
      }

      // Validamos los datos utilizando TypeBox. Si no son válidos, obtenemos los errores y los registramos antes de lanzar una excepción.
      const isValid = Value.Check(schema, dataToValidate);

      // Si la validación falla, registramos los errores detallados y lanzamos una excepción con un mensaje genérico para evitar exponer detalles sensibles en la respuesta.
      if (!isValid) {
        const errors = [...Value.Errors(schema, dataToValidate)].map((e) => ({
          path: e.path,
          message: e.message,
          value: e.value,
        }));

        logger.warn(
          `🔴 [Validate] Los datos rechazados en '${String(context.name)}'`,
          { errors },
        );

        throw new ValidationException(
          errors,
          `Error de validación en '${String(context.name)}'`,
        );
      }

      return target.apply(this, args);
    };
  };
}
