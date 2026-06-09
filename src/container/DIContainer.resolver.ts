import { type Contract, DIContainer, Scope } from "./DIContainer.js";
import { requestContext } from "../http/context/requestContext.js";

/**
 * @description Símbolo para acceder a la metadata de los decoradores de Stage 3.
 */
const metadataSymbol: symbol =
  (Symbol as any).metadata ?? Symbol.for("Symbol.metadata");

/**
 * @description Resuelve una instancia a partir de una factory registrada.
 */
export function resolveFactory<T>(
  this: DIContainer,
  contract: Contract<T>,
  factoryEntry: {
    factory: (container: DIContainer) => T;
    scope: Scope;
  },
): T {
  const { factory, scope } = factoryEntry;

  if (scope === Scope.Transient) return factory(this);

  if (scope === Scope.Request) {
    return resolveFactoryRequest.call(this, contract, factory) as T;
  }

  // Singleton
  return resolveFactorySingleton.call(this, contract, factory) as T;
}

/**
 * @description Resuelve una factory con scope Request.
 */
export function resolveFactoryRequest<T>(
  this: DIContainer,
  contract: Contract<T>,
  factory: (container: DIContainer) => unknown,
): T {
  const store = requestContext.getStore();
  if (!store) {
    throw new Error(
      `[FastifyKit DI] No se puede ejecutar la factory para ${String(contract)} fuera de un contexto HTTP.`,
    );
  }
  store.diInstances = store.diInstances || new Map();
  const existing = store.diInstances.get(contract);
  if (existing !== undefined) return existing as T;

  const instance = factory(this);
  store.diInstances.set(contract, instance);
  return instance as T;
}

/**
 * @description Resuelve una factory con scope Singleton.
 */
export function resolveFactorySingleton<T>(
  this: DIContainer,
  contract: Contract<T>,
  factory: (container: DIContainer) => unknown,
): T {
  const existing = (this as any).instances.get(contract);
  if (existing !== undefined) return existing as T;

  const instance = factory(this);
  (this as any).instances.set(contract, instance);
  return instance as T;
}

/**
 * @description Resuelve una implementación verificando su scope.
 */
export function resolveByScope<T>(
  this: DIContainer,
  contract: Contract<T>,
  Implementation: new (...args: any[]) => T,
): T {
  const metadata = (Implementation as any)[metadataSymbol];
  const scope = metadata?.scope ?? Scope.Singleton;

  if (scope === Scope.Transient) {
    return instantiate.call(this, contract, Implementation) as T;
  }

  if (scope === Scope.Request) {
    return resolveScopeRequest.call(this, contract, Implementation) as T;
  }

  // Singleton
  return resolveScopeSingleton.call(this, contract, Implementation) as T;
}

/**
 * @description Resuelve una implementación con scope Request.
 */
export function resolveScopeRequest<T>(
  this: DIContainer,
  contract: Contract<T>,
  Implementation: new (...args: any[]) => T,
): T {
  const store = requestContext.getStore();
  if (!store) {
    throw new Error(
      `[FastifyKit DI] No se puede resolver el contrato ${String(contract)} con scope 'Request' fuera de un contexto de petición HTTP.`,
    );
  }

  store.diInstances = store.diInstances || new Map();
  const existingReqInstance = store.diInstances.get(contract);
  if (existingReqInstance !== undefined) return existingReqInstance as T;

  const instance = instantiate.call(this, contract, Implementation) as T;
  store.diInstances.set(contract, instance);
  return instance;
}

/**
 * @description Resuelve una implementación con scope Singleton.
 */
export function resolveScopeSingleton<T>(
  this: DIContainer,
  contract: Contract<T>,
  Implementation: new (...args: any[]) => T,
): T {
  const existing = (this as any).instances.get(contract);
  if (existing !== undefined) return existing as T;

  return instantiate.call(this, contract, Implementation) as T;
}

/**
 * @description Intenta resolver el contrato mediante auto-descubrimiento.
 */
export function resolveAutoDiscovery<T>(
  this: DIContainer,
  contract: Contract<T>,
): T {
  // Si el contrato es una clase concreta (no abstracta), intentamos instanciarlo directamente sin registro previo
  if (typeof contract === "function") {
    // En auto-descubrimiento, delegamos a instantiate
    return instantiate.call(this, contract as any, contract as any) as T;
  }
  throw new Error(
    `No se ha registrado una implementación para el contrato: ${String(contract)}`,
  );
}

/**
 * @description Crea la instancia y gestiona el ciclo de vida de resolución.
 */
export function instantiate<T>(
  this: DIContainer,
  contract: Contract<T>,
  Implementation: new (...args: any[]) => T,
): T {
  // Prevenimos recursion infinita en el constructor (aunque con @Inject ya no debería pasar)
  if ((this as any).resolutionStack.has(contract)) {
    throw new Error(
      `Dependencia circular detectada en el constructor de ${String(contract)}. ` +
        `Usa @Inject() para inyecciones circulares.`,
    );
  }

  (this as any).resolutionStack.add(contract);

  try {
    // Creamos la instancia. Los campos se inicializan con sus valores por defecto aquí.
    const instance = new Implementation();

    // Aplicamos las inyecciones de la metadata
    applyInjections.call(this, instance, Implementation);

    // Verificamos el scope antes de guardar en el mapa de instancias
    const metadata = (Implementation as any)[metadataSymbol];
    const scope = metadata?.scope ?? Scope.Singleton;

    if (scope === Scope.Singleton) {
      (this as any).instances.set(contract, instance);
    }

    return instance;
  } finally {
    (this as any).resolutionStack.delete(contract);
  }
}

/**
 * @description Analiza la metadata e inyecta las dependencias.
 */
export function applyInjections(
  this: DIContainer,
  instance: any,
  ClassDefinition: any,
): void {
  const metadata = ClassDefinition[metadataSymbol];
  if (!metadata?.injections) return;

  for (const injection of metadata.injections) {
    const { propertyName, contractOrResolver, optional } = injection;

    // Resolvemos el contrato (soporta forward references)
    // forward reference: quiere decir que el contrato a resolver puede ser una función que retorna el contrato real,
    // lo cual es útil para resolver dependencias circulares sin necesidad de usar @Inject en el campo.
    const getTargetContract = () =>
      typeof contractOrResolver === "function" && !contractOrResolver.prototype
        ? (contractOrResolver as Function)()
        : contractOrResolver;

    const targetContract = getTargetContract();

    // Si es opcional y no está registrado explícitamente, lo marcamos como undefined.
    // NO intentamos resolverlo si es una clase para evitar el auto-registro
    // que el contenedor hace por defecto, ya que al ser opcional, el usuario
    // probablemente NO quiere que se instancie si no fue registrado.
    if (optional && !this.has(targetContract)) {
      instance[propertyName] = undefined;
      continue;
    }

    try {
      // SI la dependencia está actualmente en el stack de resolución,
      // significa que hay un ciclo. Debemos usar un Lazy Getter para romperlo.
      if ((this as any).resolutionStack.has(targetContract)) {
        defineLazyGetter.call(this, instance, propertyName, getTargetContract);
      } else {
        // Si no hay ciclo, inyectamos AHORA.
        instance[propertyName] = this.resolve(targetContract);
      }
    } catch (err) {
      if (optional) {
        instance[propertyName] = undefined;
      } else {
        throw err;
      }
    }
  }
}

/**
 * @description Define un getter perezoso que se auto-optimiza al primer acceso.
 */
export function defineLazyGetter(
  this: DIContainer,
  instance: any,
  propertyName: string | symbol,
  getContract: () => Contract<any>,
): void {
  Object.defineProperty(instance, propertyName, {
    get: () => {
      const contract = getContract();
      const resolvedInstance = this.resolve(contract);

      // Sobrescribimos con el valor real
      Object.defineProperty(instance, propertyName, {
        value: resolvedInstance,
        enumerable: true,
        configurable: true,
        writable: true,
      });

      return resolvedInstance;
    },
    set: (value: any) => {
      if (value === undefined) return;
      Object.defineProperty(instance, propertyName, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    },
    configurable: true,
    enumerable: true,
  });
}
