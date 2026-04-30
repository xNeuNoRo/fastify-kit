import type { Router, RouterOptions } from "mediasoup/types";

// Token de inyección para el SfuRoomManager, utilizado en el contenedor de dependencias.
export const SFU_ROOM_MANAGER_TOKEN = Symbol.for("SFU_ROOM_MANAGER_TOKEN");

/**
 * @description Contrato estricto para el orquestador de salas WebRTC.
 * Cualquier implementación (Local, Multi-nodo, Custom) debe cumplir con esta interfaz.
 */
export interface SfuRoomManager {
  /**
   * @description Obtiene una sala existente o la crea en el Worker óptimo.
   * @param roomId El identificador único de la sala.
   * @param options Opciones personalizadas para el Router (sobrescribe los defaults).
   * @returns El Router de mediasoup que gestiona los medios de esta sala.
   */
  getOrCreateRoom(
    roomId: string,
    options?: Partial<RouterOptions>,
  ): Promise<Router>;

  /**
   * @description Obtiene una sala existente de manera sincrónica. Lanza error si no existe.
   * @param roomId El identificador único de la sala.
   */
  getRoom(roomId: string): Router;

  /**
   * @description Verifica de forma segura y rápida si una sala existe en memoria.
   * @param roomId El identificador único de la sala.
   */
  hasRoom(roomId: string): boolean;

  /**
   * @description Destruye la sala y libera la memoria en el motor nativo de C++.
   * @param roomId El identificador único de la sala.
   */
  removeRoom(roomId: string): void;

  /**
   * @description Obtiene la cantidad total de salas activas en este nodo.
   */
  getActiveRoomsCount(): number;

  /**
   * @description Retorna una lista con los IDs de todas las salas actualmente activas.
   */
  getActiveRoomIds(): string[];
}
