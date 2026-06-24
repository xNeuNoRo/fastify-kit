import type { QueueOptions } from "../core/interfaces/queue.interface.js";
import type { DistributedOptions } from "../core/interfaces/distributed.interface.js";
import type { FastifyKitWebRtcConfig } from "../core/interfaces/webrtc.interface.js";

/**
 * @description Token para inyectar el InternalConfigService en el contenedor DI.
 * SOLO debe usarse por subsistemas internos del framework (queues, distributed, webrtc).
 */
export const INTERNAL_CONFIG_SERVICE_TOKEN = Symbol.for("INTERNAL_CONFIG_SERVICE_TOKEN");

/**
 * @description Configuración interna del framework, fuertemente tipada.
 * Define las claves y tipos que el InternalConfigService gestiona para los subsistemas
 * internos de FastifyKit (colas, distribuido, webrtc).
 *
 * Esta interfaz NO debe ser usada por código de usuario. El usuario usa ConfigService
 * con setConfig/getConfig/hasConfig para configuraciones de aplicación (PORT, DATABASE_URL, etc.).
 */
export interface InternalFrameworkConfig {
  queue?: QueueOptions;
  distributed?: DistributedOptions;
  webrtc?: FastifyKitWebRtcConfig;
}

/**
 * @description Contrato para el servicio de configuración interna del framework.
 * Gestiona la configuración de los subsistemas internos (colas, distribuido, webrtc)
 * de forma fuertemente tipada e inyectable, eliminando acoplamiento global.
 *
 * NUNCA debe usarse para configuración de usuario. Para eso usa ConfigService.setConfig/getConfig.
 */
export interface InternalConfigService {
  set<K extends keyof InternalFrameworkConfig>(key: K, value: InternalFrameworkConfig[K]): void;
  get<K extends keyof InternalFrameworkConfig>(key: K): InternalFrameworkConfig[K] | undefined;
  has<K extends keyof InternalFrameworkConfig>(key: K): boolean;
  clear(): void;
}
