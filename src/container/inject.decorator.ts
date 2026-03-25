import { container, Contract } from "../container/DIContainer";

/**
 * @description El decorador @Inject se utiliza para marcar un campo de clase como una dependencia que debe ser inyectada por el contenedor de inyección de dependencias.
 * @example
 * \@Injectable()
 * class UserService {
 *   getUser() {
 *     return { name: "John Doe" };
 *   }
 * }
 * @param contract El contrato (puede ser una clase concreta o abstracta) que se desea resolver e inyectar.
 * @returns Una función que se ejecutará cada vez que se acceda al campo decorado, resolviendo la dependencia desde el contenedor de inyección de dependencias.
 */
export function Inject<T>(contract: Contract<T>) {
  return function (_value: undefined, context: ClassFieldDecoratorContext) {
    if (context.kind !== "field") {
      throw new Error("@Inject solo puede ser aplicado a campos de clase");
    }

    // Retornamos una función que se ejecutará cada vez que se acceda al campo decorado,
    // resolviendo la dependencia desde el contenedor de inyección de dependencias.
    return function () {
      return container.resolve<T>(contract);
    };
  };
}
