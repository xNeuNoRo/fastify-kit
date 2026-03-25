export class Mapper {
  /**
   * @description Función genérica para mapear las propiedades de un objeto fuente a un objeto destino, solo actualizando las propiedades que están definidas en el objeto fuente.
   * @param target El objeto destino al que se le asignarán las propiedades del objeto fuente.
   * @param source El objeto fuente que contiene las propiedades a asignar al objeto destino.
   * @example
   * Supongamos que tenemos una clase User con varias propiedades, y queremos actualizar solo algunas de ellas a partir de un objeto parcial:
   * class User {
   *   name: string;
   *   email: string;
   *   age: number;
   * }
   *
   * const user = new User();
   * user.name = "John Doe";
   * user.email = "johndoe@email.com";
   * user.age = 30;
   *
   * const partialUpdate = { email: "johndoe100@email.com", age: 31 };
   * Mapper.patch(user, partialUpdate);
   *
   * En este ejemplo, solo las propiedades "email" y "age" del objeto "user" serán actualizadas con los valores del objeto "partialUpdate", mientras que la propiedad "name" permanecerá sin cambios.
   * @returns El objeto destino con las propiedades actualizadas según el objeto fuente.
   */
  static patch<T extends object, S extends Partial<T>>(
    target: T,
    source: S | null | undefined,
  ): T {
    if (source) {
      for (const key of Object.keys(source) as Array<keyof S>) {
        if (source[key] !== undefined) {
          (target as unknown as S)[key] = source[key];
        }
      }
    }

    return target;
  }

  /**
   * @description Función genérica para crear una nueva instancia de una clase destino a partir de un objeto fuente, mapeando solo las propiedades que están definidas en el objeto fuente.
   * @param TargetClass La clase destino a la que se le asignarán las propiedades del objeto fuente. Esta clase debe tener un constructor sin parámetros para que pueda ser instanciada correctamente.
   * @param source El objeto fuente que contiene las propiedades a asignar a la nueva instancia de la clase destino.
   * @example
   * Supongamos que tenemos una clase User con varias propiedades, y queremos crear una nueva instancia de User a partir de un objeto parcial:
   * class User {
   *   name: string;
   *   email: string;
   *   age: number;
   * }
   *
   * const partialData = { name: "John Doe", email: "johndoe@email.com" };
   * const user = Mapper.to(User, partialData);
   *
   * En este ejemplo, se creará una nueva instancia de la clase User con las propiedades "name" y "email" asignadas según el objeto "partialData". La propiedad "age" no será asignada y quedará con su valor por defecto (undefined).
   * @returns Una nueva instancia de la clase destino con las propiedades asignadas según el objeto fuente.
   */
  static to<T extends object, S extends Partial<T>>(
    TargetClass: new (...args: any[]) => T,
    source: S,
  ): T {
    const instance = new TargetClass();
    return this.patch(instance, source);
  }

  /**
   * @description Función genérica para mapear un array de objetos fuente a un array de instancias de una clase destino, utilizando la función "to" para mapear cada objeto individualmente.
   * @param TargetClass La clase destino a la que se le asignarán las propiedades de cada objeto fuente. Esta clase debe tener un constructor sin parámetros para que pueda ser instanciada correctamente.
   * @param sourceArray El array de objetos fuente que contiene las propiedades a asignar a cada nueva instancia de la clase destino.
   * @example
   * Supongamos que tenemos una clase User con varias propiedades, y queremos crear un array de instancias de User a partir de un array de objetos parciales:
   * class User {
   *   name: string;
   *   email: string;
   *   age: number;
   * }
   *
   * const partialDataArray = [
   *   { name: "John Doe", email: "johndoe@email.com" },
   *   { name: "Jane Smith", age: 25 },
   * ];
   * const users = Mapper.toArray(User, partialDataArray);
   *
   * En este ejemplo, se crearán nuevas instancias de la clase User con las propiedades asignadas según los objetos en "partialDataArray". Las propiedades no especificadas en los objetos fuente quedarán con su valor por defecto (undefined).
   * @returns Un array de instancias de la clase destino con las propiedades asignadas según los objetos fuente.
   */
  static toArray<T extends object, S extends Partial<T>>(
    TargetClass: new (...args: any[]) => T,
    sourceArray: S[],
  ): T[] {
    if (!Array.isArray(sourceArray) || sourceArray.length === 0) return [];
    return sourceArray.map((source) => this.to(TargetClass, source));
  }

  /**
   * @description Función genérica para castear un valor a un tipo específico, utilizada principalmente para ayudar a los decoradores como \@MapTo a inferir el tipo de retorno correcto.
   * @param value El valor que se desea castear a un tipo específico. Este valor puede ser de cualquier tipo, y la función simplemente lo devuelve con el tipo genérico T.
   * @example
   * Supongamos que tenemos una clase User y queremos mapear un objeto plano a una instancia de User usando \@MapTo.
   * class User {
   *  name: string;
   *  constructor(data: { name: string }) {
   *   this.name = data.name;
   *  }
   * }
   * // En un método decorado con \@MapTo(User), podríamos usar mappedTo para ayudar a inferir el tipo de retorno:
   * class UserService {
   *  \@MapTo(User)
   *  getUser() {
   *   const rawData = { name: "John Doe" };
   *   return mappedTo<User>(rawData); // Esto ayuda a que TypeScript infiera que el retorno es de tipo User
   *  }
   * }
   * @remarks Esta función no realiza ninguna transformación real en el valor, sino que es una herramienta de ayuda para la inferencia de tipos en TypeScript. Es especialmente útil en escenarios donde el tipo de retorno no puede ser inferido automáticamente por el compilador, como en decoradores que transforman el resultado de un método.
   * @returns El mismo valor que se pasó como argumento, pero con el tipo genérico T. Esta función no realiza ninguna transformación real en el valor, sino que es una herramienta de ayuda para la inferencia de tipos en TypeScript.
   */
  static infer<T>(value: unknown): T {
    return value as T;
  }
}
