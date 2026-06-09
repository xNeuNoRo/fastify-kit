import type { Contract } from "../container/DIContainer.js";
import { FastifyKitMetadata } from "../http/decorators/types.js";

/**
 * @description El decorador \@Inject se utiliza para marcar un campo de clase como una dependencia que debe ser inyectada por el contenedor de inyección de dependencias.
 * @example
 * \@Injectable()
 * class UserService {
 *   \@Inject(() => DatabaseService) // Soporta forward references con funciones resolver
 *   private db!: DatabaseService;
 * }
 *
 * // O sin forward reference:
 * \@Injectable()
 * class UserService {
 *   \@Inject(DatabaseService) // Inyecta DatabaseService directamente
 *   private db!: DatabaseService;
 * }
 * @param contractOrResolver El contrato (puede ser una clase concreta o abstracta) que se desea resolver e inyectar o una función resolver.
 * @returns Una función que se ejecutará cada vez que se acceda al campo decorado, resolviendo la dependencia desde el contenedor de inyección de dependencias.
 */
export function Inject<T>(
  contractOrResolver: Contract<T> | (() => Contract<T>),
) {
  return function (_value: undefined, context: ClassFieldDecoratorContext) {
    if (context.kind !== "field") {
      throw new Error("@Inject solo puede ser aplicado a campos de clase");
    }

    // Usamos el objeto metadata de Stage 3 para registrar las inyecciones.
    const metadata = context.metadata as FastifyKitMetadata;
    metadata.injections = metadata.injections || [];

    // Buscamos si ya existe una entrada para esta propiedad (por si se aplicó @Optional antes)
    let injection = metadata.injections.find(
      (i) => i.propertyName === context.name,
    );

    if (!injection) {
      injection = {
        propertyName: context.name,
        contractOrResolver: undefined as any,
      };
      metadata.injections.push(injection);
    }

    injection.contractOrResolver = contractOrResolver;
  };
}

/**
 * @description El decorador \@Optional marca una inyección como opcional.
 * Si la dependencia no está registrada en el contenedor, se inyectará undefined en lugar de lanzar un error.
 * Debe usarse junto con \@Inject.
 * @example
 * \@Injectable()
 * class UserService {
 *    \@Inject(() => DatabaseService)
 *    \@Optional() // Si DatabaseService no está registrado, db será undefined en lugar de lanzar un error
 *    private db?: DatabaseService;
 * }
 * @returns Una función que marca la inyección como opcional en la metadata de la clase.
 */
export function Optional() {
  return function (_value: undefined, context: ClassFieldDecoratorContext) {
    if (context.kind !== "field") {
      throw new Error("@Optional solo puede ser aplicado a campos de clase");
    }

    const metadata = context.metadata as FastifyKitMetadata;
    metadata.injections = metadata.injections || [];

    let injection = metadata.injections.find(
      (i) => i.propertyName === context.name,
    );

    if (!injection) {
      injection = {
        propertyName: context.name,
        contractOrResolver: undefined as any,
      };
      metadata.injections.push(injection);
    }

    injection.optional = true;
  };
}

/**
 * @description El decorador \@PostConstruct marca un método para que se ejecute automáticamente
 * después de que el contenedor de inyección de dependencias haya instanciado la clase
 * e inyectado todas sus dependencias.
 * @example
 * \@Injectable()
 * class UserService {
 *   \@PostConstruct() // Este método se ejecutará automáticamente después de la instanciación e inyección de dependencias
 *   initialize() {
 *     console.log("UserService ha sido inicializado con todas sus dependencias inyectadas");
 *   }
 * }
 * @returns Una función que registra el método marcado en la metadata de la clase para su ejecución posterior.
 */
export function PostConstruct() {
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    if (context.kind !== "method") {
      throw new Error("@PostConstruct solo puede ser aplicado a métodos");
    }

    const metadata = context.metadata as FastifyKitMetadata;
    metadata.postConstructMethod = context.name;
  };
}
