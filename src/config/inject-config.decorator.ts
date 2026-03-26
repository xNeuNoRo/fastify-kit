import { ConfigRegistry } from "../config/ConfigRegistry.js";

/**
 * @description Decorador de campo para inyectar configuraciones registradas en el ConfigRegistry.
 * Permite acceder a configuraciones específicas por namespace directamente desde los campos de clase.
 * @param namespace El namespace bajo el cual se ha registrado la configuración en el ConfigRegistry.
 * Al acceder al campo decorado, se retornará la configuración correspondiente a ese namespace.
 * @example
 * ```typescript
 * // Primero debes registrar una configuración en el ConfigRegistry bajo un namespace específico
 * ConfigRegistry.set("database", {
 *  host: "localhost",
 *  port: 5432,
 *  username: "user",
 *  password: "password"
 * });
 *
 * // Luego puedes inyectarla en el paradigma orientado a objetos usando el decorador \@InjectConfig
 * class MyService {
 *   \@InjectConfig("database")
 *   private readonly dbConfig: DatabaseConfig;
 *
 *   constructor() {
 *     console.log(this.dbConfig); // Accede a la configuración de la base de datos registrada bajo el namespace "database"
 *   }
 * }
 * ```
 * @remarks Es importante asegurarse de que la configuración esté registrada en el ConfigRegistry antes de intentar inyectarla, de lo contrario el campo decorado retornará undefined. Este decorador es especialmente útil para centralizar la gestión de configuraciones y facilitar su acceso en diferentes partes de la aplicación sin necesidad de pasar manualmente las configuraciones a través de constructores o métodos.
 * @returns Una función que se ejecutará cada vez que se acceda al campo decorado,
 * retornando la configuración registrada bajo el namespace especificado.
 */
export function InjectConfig(namespace: string) {
  return function <This, Value>(
    _target: undefined,
    context: ClassFieldDecoratorContext<This, Value>,
  ) {
    if (context.kind !== "field") {
      throw new Error(
        "@InjectConfig solo puede ser aplicado a campos de clase",
      );
    }

    // Este initializer recibe el valor que se le haya asignado por defecto a la variable
    return function (this: This, initialValue: Value) {
      const config = ConfigRegistry.get(namespace);

      // Si la config existe en el Registry, la usamos. Si no, usamos el valor por defecto.
      return (config === undefined ? initialValue : config) as Value;
    };
  };
}
