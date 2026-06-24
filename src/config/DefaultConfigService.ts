import { Injectable } from "../container/injectable.decorator.js";
import {
  CONFIG_SERVICE_TOKEN,
  type ConfigService,
} from "./ConfigService.js";
import {
  type InternalConfigService,
  type InternalFrameworkConfig,
} from "./InternalConfigService.js";

/**
 * @description Implementación unificada de ConfigService (usuario) e InternalConfigService (framework).
 * Mantiene dos stores separados:
 * - state: configuración interna tipada del framework (queue, distributed, webrtc)
 * - configStore: configuración genérica de usuario (PORT, DATABASE_URL, etc.)
 *
 * Ambas interfaces comparten la misma instancia singleton en el DI,
 * registrada con ambos tokens (CONFIG_SERVICE_TOKEN e INTERNAL_CONFIG_SERVICE_TOKEN).
 * Esto garantiza que el contenedor resuelva la misma instancia para ambos contratos.
 */
@Injectable(CONFIG_SERVICE_TOKEN)
export class DefaultConfigService implements ConfigService, InternalConfigService {
  private readonly state: InternalFrameworkConfig = {};
  private readonly configStore = new Map<string, unknown>();

  // === InternalConfigService (framework subsystems) ===

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

  // === ConfigService (user config) ===

  setConfig<T>(namespace: string, value: T): void {
    this.configStore.set(namespace, value);
  }

  getConfig<T>(namespace: string): T | undefined {
    return this.configStore.get(namespace) as T | undefined;
  }

  hasConfig(namespace: string): boolean {
    return this.configStore.has(namespace);
  }

  // === Shared ===

  clear(): void {
    Object.keys(this.state).forEach((k) => delete (this.state as any)[k]);
    this.configStore.clear();
  }
}
