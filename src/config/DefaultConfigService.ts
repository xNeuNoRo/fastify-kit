import { Injectable } from "../container/injectable.decorator.js";
import {
  CONFIG_SERVICE_TOKEN,
  type ConfigService,
  type InternalFrameworkConfig,
} from "./ConfigService.js";

/**
 * @description Implementación por defecto del ConfigService.
 * Utiliza un Map privado para almacenar la configuración interna del framework
 * de forma fuertemente tipada, eliminando el acoplamiento global que tenía
 * el antiguo InternalConfig estático.
 *
 * Se registra como Singleton en el contenedor DI para que todos los subsistemas
 * compartan la misma instancia durante el ciclo de vida de la aplicación.
 */
@Injectable(CONFIG_SERVICE_TOKEN)
export class DefaultConfigService implements ConfigService {
  private readonly state: InternalFrameworkConfig = {};
  private readonly configStore = new Map<string, unknown>();

  set<K extends keyof InternalFrameworkConfig>(
    key: K,
    value: InternalFrameworkConfig[K],
  ): void {
    this.state[key] = value;
  }

  get<K extends keyof InternalFrameworkConfig>(
    key: K,
  ): InternalFrameworkConfig[K] | undefined {
    return this.state[key];
  }

  has<K extends keyof InternalFrameworkConfig>(key: K): boolean {
    return key in this.state;
  }

  setConfig<T>(namespace: string, value: T): void {
    this.configStore.set(namespace, value);
  }

  getConfig<T>(namespace: string): T | undefined {
    return this.configStore.get(namespace) as T | undefined;
  }

  hasConfig(namespace: string): boolean {
    return this.configStore.has(namespace);
  }

  clear(): void {
    Object.keys(this.state).forEach((k) => delete (this.state as any)[k]);
    this.configStore.clear();
  }
}
