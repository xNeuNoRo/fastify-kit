type Constructor<T> = new (...args: any[]) => T;

type ValidReturnType<T> =
  | T
  | T[]
  | null
  | undefined
  | Promise<T | T[] | null | undefined>;

/**
 * @description Decorador de método para transformar el resultado de un método en una
 * instancia de una clase específica. Este decorador es útil para mapear objetos planos
 * (como los que se obtienen de una base de datos) a instancias de clases con métodos y lógica adicional.
 * @param EntityClass La clase a la que se desea mapear el resultado del método.
 * Esta clase debe tener un constructor que acepte un objeto con las propiedades necesarias para inicializar la instancia.
 * @example
 * class User {
 *   name: string;
 *   constructor(data: { name: string }) {
 *     this.name = data.name;
 *   }
 *
 *   greet() {
 *     return `Hello, ${this.name}!`;
 *   }
 * }
 *
 * class UserService {
 *   \@MapTo(User)
 *   getUser() {
 *     return { name: "John Doe" }; // Esto se mapeará a una instancia de User
 *   }
 * }
 * 
 * const service = new UserService();
 * const user = service.getUser();
 * console.log(user instanceof User); // true
 * console.log(user.greet()); // "Hello, John Doe!"
 * @remarks Si el método devuelve un array de objetos, cada uno de ellos se mapeará a una instancia de la clase especificada.
 * Si el método devuelve null o undefined, se devolverá tal cual sin intentar mapearlo.
 * @returns Una función que envuelve el método original, transformando su resultado en una instancia de la clase especificada.
 */
export function MapTo<T>(EntityClass: Constructor<T>) {
  return function <This, Args extends any[], Return extends ValidReturnType<T>>(
    target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >,
  ) {
    if (context.kind !== "method") {
      throw new Error("@MapTo solo puede ser aplicado a métodos de clase");
    }

    const transform = (data: any): any => {
      if (!data) return data;

      const mapper = (item: any) => {
        // Creamos la instancia sin disparar el constructor
        const instance = Object.create(EntityClass.prototype); // .prototype nos da basicamente el plano completo de la clase
        return Object.assign(instance, item);
      };

      return Array.isArray(data) ? data.map(mapper) : mapper(data);
    };

    return function (this: This, ...args: Args): Return {
      const result = target.apply(this, args);

      if (result instanceof Promise) {
        // Si es promesa, transformamos con el then() luego de resolverla
        return result.then((data) => transform(data)) as Return;
      }

      // Si no es promesa, transformamos directamente el resultado
      return transform(result);
    };
  };
}
