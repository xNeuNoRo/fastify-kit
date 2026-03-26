// El contrato puede ser una clase concreta o una clase abstracta.
export type Contract<T> =
  | (new (...args: any[]) => T)
  | (abstract new (...args: any[]) => T)
  | symbol;

class DIContainer {
  private readonly registry = new Map<
    Contract<unknown>, // El contrato (puede ser una clase concreta o abstracta)
    new (...args: any[]) => unknown // El constructor de la clase concreta que implementa el contrato
  >();
  private readonly instances = new Map<Contract<unknown>, unknown>();

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
    // Verificamos si ya existe una instancia para el contrato solicitado
    if (this.instances.has(contract)) {
      return this.instances.get(contract) as T;
    }

    // Si no existe una instancia, verificamos si hay una implementación registrada para el contrato
    const Implementation = this.registry.get(contract);
    if (!Implementation) {
      // Si el contrato es una clase concreta (no abstracta), intentamos instanciarlo directamente sin registro previo
      if (typeof contract === "function") {
        // Creamos una nueva instancia de la clase concreta y la almacenamos en el contenedor para futuras resoluciones
        const instance = new (contract as any)();
        this.instances.set(contract, instance);
        return instance as T;
      }
      throw new Error(
        `No se ha registrado una implementación para el contrato: ${String(contract)}`,
      );
    }

    // Creamos una nueva instancia de la implementación concreta
    const instance = new Implementation();
    // Almacenamos la instancia creada en el contenedor para futuras resoluciones
    this.instances.set(contract, instance);
    // Devolvemos la instancia creada
    return instance as T;
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
