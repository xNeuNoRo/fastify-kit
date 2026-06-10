import type { QueueOptions } from "../core/interfaces/queue.interface.js";
import type { DistributedOptions } from "../core/interfaces/distributed.interface.js";
import type { FastifyKitWebRtcConfig } from "../core/interfaces/webrtc.interface.js";

export interface InternalFrameworkConfig {
  queue?: QueueOptions;
  distributed?: DistributedOptions;
  webrtc?: FastifyKitWebRtcConfig;
}

/**
 * @description Registro de configuración interno exclusivo para el funcionamiento del framework.
 * A diferencia del ConfigRegistry (que es público y usa strings genéricos), el InternalConfig
 * está fuertemente tipado, no utiliza strings mágicos y no expone métodos para borrar todo
 * el estado, protegiendo así la infraestructura crítica (colas, webrtc, redis) de manipulaciones
 * accidentales por parte del código del usuario.
 */
export class InternalConfig {
  private static readonly state: InternalFrameworkConfig = {};

  /**
   * Registra una configuración interna del framework.
   * @param key La clave tipada de la configuración.
   * @param value El objeto de configuración correspondiente a la clave.
   */
  static set<K extends keyof InternalFrameworkConfig>(
    key: K,
    value: InternalFrameworkConfig[K],
  ): void {
    this.state[key] = value;
  }

  /**
   * Obtiene una configuración interna del framework.
   * @param key La clave tipada de la configuración.
   * @returns La configuración solicitada de forma tipada, o undefined si no fue establecida.
   */
  static get<K extends keyof InternalFrameworkConfig>(
    key: K,
  ): InternalFrameworkConfig[K] {
    return this.state[key];
  }
}
