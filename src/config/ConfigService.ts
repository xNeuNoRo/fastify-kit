import type { QueueOptions } from "../core/interfaces/queue.interface.js";
import type { DistributedOptions } from "../core/interfaces/distributed.interface.js";
import type { FastifyKitWebRtcConfig } from "../core/interfaces/webrtc.interface.js";

/**
 * @description Token para inyectar el ConfigService en el contenedor DI.
 */
export const CONFIG_SERVICE_TOKEN = Symbol.for("CONFIG_SERVICE_TOKEN");

/**
 * @description Configuración interna del framework, fuertemente tipada.
 * Define las claves y tipos que el ConfigService gestiona para los subsistemas
 * internos de FastifyKit (colas, distribuido, webrtc).
 */
export interface InternalFrameworkConfig {
  queue?: QueueOptions;
  distributed?: DistributedOptions;
  webrtc?: FastifyKitWebRtcConfig;
}

/**
 * @description Contrato para el servicio de configuración interna del framework.
 * Reemplaza al antiguo InternalConfig estático con una interfaz inyectable,
 * permitiendo testing aislado, multi-tenancy y eliminando el acoplamiento global.
 */
export interface ConfigService {
  /**
   * Registra una configuración interna del framework.
   * @param key La clave tipada de la configuración.
   * @param value El objeto de configuración correspondiente a la clave.
   */
  set<K extends keyof InternalFrameworkConfig>(
    key: K,
    value: InternalFrameworkConfig[K],
  ): void;

  /**
   * Obtiene una configuración interna del framework.
   * @param key La clave tipada de la configuración.
   * @returns La configuración solicitada de forma tipada, o undefined si no fue establecida.
   */
  get<K extends keyof InternalFrameworkConfig>(
    key: K,
  ): InternalFrameworkConfig[K] | undefined;

  /**
   * Verifica si existe una configuración registrada bajo una clave específica.
   * @param key La clave tipada de la configuración.
   * @returns true si la configuración existe, false en caso contrario.
   */
  has<K extends keyof InternalFrameworkConfig>(key: K): boolean;
}
