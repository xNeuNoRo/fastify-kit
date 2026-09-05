import {
  resolveFactory,
  resolveByScope,
  resolveAutoDiscovery,
} from "./DIContainer.resolver.js";

// El contrato puede ser una clase concreta o una clase abstracta.
export type Contract<T> =
  | (new (...args: any[]) => T)
  | (abstract new (...args: any[]) => T)
  | symbol;

/**
 * @description Define los tipos de ciclo de vida (scope) de una instancia en el contenedor.
 */
export enum ScopeType {
  /** Una sola instancia para toda la aplicación (Por defecto) */
  Singleton = 0,
  /** Una instancia nueva cada vez que se solicita */
  Transient = 1,
  /** Una instancia nueva por cada petición HTTP */
  Request = 2,
}

export class DIContainer {
  private readonly registry = new Map<
    Contract<unknown>,
    new (...args: any[]) => unknown
  >();
  private readonly instances = new Map<Contract<unknown>, unknown>();
  private readonly factories = new Map<
    Contract<unknown>,
    { factory: (container: DIContainer) => unknown; scope: ScopeType }
  >();

  // Stack de resolución actual para detectar dependencias circulares.
  private readonly resolutionStack = new Set<Contract<any>>();

  /**
   * @description Registra una implementación concreta para un contrato específico.
   */
  registerClass<T>(
    contract: Contract<T>,
    Implementation: new (...args: any[]) => T,
  ): void {
    this.instances.delete(contract);
    this.factories.delete(contract);
    this.registry.set(contract, Implementation);
  }

  /**
   * @description Registra una instancia concreta para un contrato específico.
   */
  registerInstance<T>(contract: Contract<T>, instance: T): void {
    this.registry.delete(contract);
    this.factories.delete(contract);
    this.instances.set(contract, instance);
  }

  /**
   * @description Registra una factory para un contrato específico.
   */
  registerFactory<T>(
    contract: Contract<T>,
    factory: (container: DIContainer) => T,
    scope: ScopeType = ScopeType.Singleton,
  ): void {
    this.instances.delete(contract);
    this.registry.delete(contract);
    this.factories.set(contract, { factory, scope });
  }

  /**
   * @description Resuelve un contrato a su instancia correspondiente.
   */
  resolve<T>(contract: Contract<T>): T {
    const factoryEntry = this.factories.get(contract);
    if (factoryEntry) {
      return resolveFactory.call(this, contract, factoryEntry as any) as T;
    }

    const Implementation = this.registry.get(contract);
    if (Implementation) {
      return resolveByScope.call(this, contract, Implementation as any) as T;
    }

    const existing = this.instances.get(contract);
    if (existing !== undefined) return existing as T;

    return resolveAutoDiscovery.call(this, contract) as T;
  }

  /**
   * @description Verifica si un contrato está registrado.
   */
  has<T>(contract: Contract<T>): boolean {
    return (
      this.instances.has(contract) ||
      this.registry.has(contract) ||
      this.factories.has(contract)
    );
  }

  /**
   * @description Elimina un contrato del contenedor, incluyendo su instancia y factory si existen.
   */
  unregister<T>(contract: Contract<T>): void {
    this.registry.delete(contract);
    this.instances.delete(contract);
    this.factories.delete(contract);
  }

  /**
   * @description Limpia todas las registraciones e instancias.
   */
  clearAll(): void {
    this.registry.clear();
    this.instances.clear();
    this.factories.clear();
  }
}

// Exportamos un singleton del contenedor de inyección de dependencias
export const container = new DIContainer();
