// El contrato puede ser una clase concreta o una clase abstracta.
export type Contract<T> =
  | (new (...args: any[]) => T)
  | (abstract new (...args: any[]) => T)
  | symbol;

/**
 * @description Symbol para acceder a la metadata
 */
const metadataSymbol: symbol =
  (Symbol as any).metadata ?? Symbol.for("Symbol.metadata");

class DIContainer {
  private readonly registry = new Map<
    Contract<unknown>, // El contrato (puede ser una clase concreta o abstracta)
    new (...args: any[]) => unknown // El constructor de la clase concreta que implementa el contrato
  >();
  private readonly instances = new Map<Contract<unknown>, unknown>();

  // Stack de resolución actual para detectar dependencias circulares.
  private readonly resolutionStack = new Set<Contract<any>>();

  /**
   * @description Registra una implementación concreta para un contrato específico en el contenedor de inyección de dependencias.
   * @param contract El contrato (puede ser una clase concreta o abstracta) para el cual se desea registrar la implementación.
   * @param Implementation La clase concreta que implementa el contrato.
   * Esta clase debe tener un constructor que acepte las dependencias necesarias para su instanciación.
   */
  registerClass<T>(
    contract: Contract<T>,
    Implementation: new (...args: any[]) => T,
  ): void {
    // Si habia una instancia registrada previamente, lo eliminamos para evitar conflictos y asegurar que la nueva implementación se pueda resolver correctamente
    this.instances.delete(contract);
    this.registry.set(contract, Implementation);
  }

  /**
   * @description Registra una instancia concreta para un contrato específico en el contenedor de inyección de dependencias.
   * @param contract El contrato (puede ser una clase concreta o abstracta) para el cual se desea registrar la instancia.
   * @param instance La instancia concreta que implementa el contrato. Esta instancia se utilizará directamente cuando se resuelva el contrato.
   */
  registerInstance<T>(contract: Contract<T>, instance: T): void {
    // Si habia un contrato registrado previamente, lo eliminamos para evitar conflictos y asegurar que la nueva instancia se pueda resolver correctamente
    this.registry.delete(contract);
    this.instances.set(contract, instance);
  }

  resolve<T>(contract: Contract<T>): T {
    // Verificamos si ya existe una instancia registrada para
    // este contrato para asi evitar resolverlo de nuevo
    const existing = this.instances.get(contract);
    if (existing !== undefined) return existing as T;

    // Buscamos la implementación
    const Implementation = this.registry.get(contract);

    // Si no está registrada pero es una clase, intentamos registrarla on-the-fly
    if (!Implementation) {
      // Si el contrato es una clase concreta (no abstracta), intentamos instanciarlo directamente sin registro previo
      if (typeof contract === "function") {
        return this.instantiate(contract as any, contract as any);
      }
      throw new Error(
        `No se ha registrado una implementación para el contrato: ${String(contract)}`,
      );
    }

    return this.instantiate(contract, Implementation) as T;
  }

  /**
   * @description Crea la instancia y gestiona el ciclo de vida de resolución.
   */
  private instantiate<T>(
    contract: Contract<T>,
    Implementation: new (...args: any[]) => T,
  ): T {
    // Prevenimos recursion infinita en el constructor (aunque con @Inject ya no debería pasar)
    if (this.resolutionStack.has(contract)) {
      throw new Error(
        `Dependencia circular detectada en el constructor de ${String(contract)}. ` +
          `Usa @Inject() para inyecciones circulares.`,
      );
    }

    this.resolutionStack.add(contract);

    try {
      // Creamos la instancia. Los campos se inicializan con sus valores por defecto aquí.
      const instance = new Implementation();

      // Aplicamos las inyecciones de la metadata
      this.applyInjections(instance, Implementation);

      // Guardamos en el map de instancias
      this.instances.set(contract, instance);

      return instance;
    } finally {
      this.resolutionStack.delete(contract);
    }
  }

  /**
   * @description Analiza la metadata e inyecta las dependencias.
   */
  private applyInjections(instance: any, ClassDefinition: any): void {
    const metadata = ClassDefinition[metadataSymbol];
    if (!metadata?.injections) return;

    for (const injection of metadata.injections) {
      const { propertyName, contractOrResolver } = injection;

      // Resolvemos el contrato (soporta forward references)
      // forward reference: quiere decir que el contrato a resolver puede ser una función que retorna el contrato real,
      // lo cual es útil para resolver dependencias circulares sin necesidad de usar @Inject en el campo.
      const getTargetContract = () =>
        typeof contractOrResolver === "function" &&
        !contractOrResolver.prototype
          ? (contractOrResolver as Function)()
          : contractOrResolver;

      const targetContract = getTargetContract();

      // SI la dependencia está actualmente en el stack de resolución,
      // significa que hay un ciclo. Debemos usar un Lazy Getter para romperlo.
      if (this.resolutionStack.has(targetContract)) {
        this.defineLazyGetter(instance, propertyName, getTargetContract);
      } else {
        // Si no hay ciclo, inyectamos AHORA.
        // Esto hace que la inyección sea inmediata y
        // no tenga la sobrecarga de un getter, lo cual es mejor para el rendimiento.
        instance[propertyName] = this.resolve(targetContract);
      }
    }
  }

  /**
   * @description Define un getter perezoso que se auto-optimiza al primer acceso.
   */
  private defineLazyGetter(
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

  /**
   * @description Verifica si un contrato está explícitamente registrado en el contenedor
   * (ya sea mediante una implementación/instancia, o porque ya fue resuelto previamente).
   * @param contract El contrato a verificar.
   * @returns true si el contrato está registrado en el contenedor, false de lo contrario.
   */
  has<T>(contract: Contract<T>): boolean {
    return this.instances.has(contract) || this.registry.has(contract);
  }

  /**
   * @description Elimina todas las implementaciones e instancias registradas en el contenedor de inyección de dependencias,
   * dejando el contenedor vacío y listo para nuevas registraciones. Util para entornos de testing.
   */
  clearAll(): void {
    this.registry.clear();
    this.instances.clear();
  }
}

// Exportamos un singleton del contenedor de inyección de dependencias
export const container = new DIContainer();
