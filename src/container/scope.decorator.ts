import { Scope } from "./DIContainer.js";
import type { FastifyKitMetadata } from "../http/decorators/types.js";

/**
 * @description Decorador para definir el ciclo de vida (scope) de una clase en el contenedor DI.
 * @param scope El tipo de ciclo de vida: Singleton, Transient o Request.
 * @example
 * \@Scope(Scope.Transient)
 * \@Injectable()
 * class MyService {}
 * @returns Una función que se ejecutará al definir la clase, asignando el scope
 * para que el contenedor DI pueda gestionarlo correctamente.
 */
export function ScopeDecorator(scope: Scope) {
  return function <T, Args extends any[]>(
    _ClassDefinition: new (...args: Args) => T,
    context: ClassDecoratorContext<new (...args: Args) => T>,
  ) {
    if (context.kind !== "class") {
      throw new Error("@Scope solo puede ser aplicado a clases");
    }

    const metadata = context.metadata as FastifyKitMetadata;
    metadata.scope = scope;
  };
}

export { ScopeDecorator as Scope };
