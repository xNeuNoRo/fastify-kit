import { container } from "../../container/DIContainer.js";
import { getLogger } from "../../logger/logger.factory.js";
import {
  SFU_ROOM_MANAGER_TOKEN,
  type SfuRoomManager,
} from "../interfaces/SfuRoomManager.js";
import { AdvancedSfuRoomManager } from "./AdvancedSfuRoomManager.js";

/**
 * @description Factory para obtener el gestor de salas SFU activo.
 * Intenta resolverlo desde el contenedor de dependencias (por si el desarrollador inyectó uno personalizado).
 * Si no hay ninguno registrado, utiliza el AdvancedSfuRoomManager por defecto.
 */
export function getSfuRoomManager(): SfuRoomManager {
  if (!container.has(SFU_ROOM_MANAGER_TOKEN)) {
    getLogger().info(
      "[FastifyKit WebRTC] No se detectó un SfuRoomManager personalizado. Utilizando AdvancedSfuRoomManager por defecto.",
    );

    // Lo registramos en el contenedor como un Singleton
    container.registerClass(SFU_ROOM_MANAGER_TOKEN, AdvancedSfuRoomManager);
  }

  return container.resolve<SfuRoomManager>(SFU_ROOM_MANAGER_TOKEN);
}
