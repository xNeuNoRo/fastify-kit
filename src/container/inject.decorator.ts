import { container, type Contract } from "../container/DIContainer.js";

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

    // Agregamos un inicializador al campo decorado que se ejecutará durante la instanciación de la clase
    context.addInitializer(function (this: any) {
      this[context.name] = container.resolve<T>(contract);
    });

    // Retornamos una función que se ejecutará cada vez que se acceda al campo decorado,
    // resolviendo la dependencia desde el contenedor de inyección de dependencias.
    return function () {
      return container.resolve<T>(contract);
    };
  };
}
