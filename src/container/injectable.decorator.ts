import { container, Contract } from "../container/DIContainer";

/**
 * @description Decorador para marcar una clase como inyectable en el contenedor de dependencias.
 * Permite registrar la clase en el contenedor para que pueda ser instanciada y gestionada automáticamente.
 * @param targetContract Opcionalmente, se puede proporcionar un contrato (interfaz o clase abstracta) que la clase implementa.
 * @example
 * \@Injectable()
 * class UserService {
 *   getUser() {
 *     return { name: "John Doe" };
 *   }
 * }
 * // O con contrato explícito
 * interface IUserService {
 *   getUser(): { name: string };
 * }
 *
 * \@Injectable<IUserService>(IUserService)
 * class UserService implements IUserService {
 *   getUser() {
 *     return { name: "John Doe" };
 *   }
 * }
 * @returns Una función que envuelve la definición de la clase, registrándola en el contenedor de inyección de dependencias con la key determinada.
 */
export function Injectable<T>(targetContract?: Contract<T>) {
  return function <This, Args extends any[], Return>(
    ClassDefinition: new (...args: Args) => T, // La clase que se le pasara autom.
    context: ClassDecoratorContext, // Contexto del decorador de clase
  ) {
    // Si no es una clase, no hacemos nada
    if (context.kind !== "class") {
      throw new Error("@Injectable solo puede ser aplicado a clases");
    }

    // Si se proporciona un contrato, lo usamos como key. De lo contrario, usamos la propia clase como key.
    const key = targetContract || ClassDefinition;

    // Registramos la clase en el contenedor de inyección de dependencias utilizando la key determinada
    container.registerClass(key, ClassDefinition);
  };
}
