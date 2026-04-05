import { container } from "../../container/DIContainer.js";
import { getLogger } from "../../logger/logger.factory.js";
import {
  WS_ROOM_MANAGER_TOKEN,
  type WsRoomManager,
} from "../interfaces/WsRoomManager.js";
import { MemoryRoomManager } from "./MemoryRoomManager.js";

let fallbackRoomManager: WsRoomManager | null = null;

/**
 * @description Factory para obtener el gestor de salas activo.
 * Intenta resolverlo desde el contenedor de dependencias (por si inyectó uno personalizado con Redis/RabbitMQ).
 * Si no hay ninguno registrado, utiliza el MemoryRoomManager por defecto.
 */
export function getRoomManager(): WsRoomManager {
  if (container.has(WS_ROOM_MANAGER_TOKEN)) {
    return container.resolve<WsRoomManager>(WS_ROOM_MANAGER_TOKEN);
  }

  if (!fallbackRoomManager) {
    getLogger().debug(
      "[FastifyKit WS] Utilizando MemoryRoomManager por defecto para las salas de WebSockets.",
    );
    fallbackRoomManager = new MemoryRoomManager();
  }

  return fallbackRoomManager;
}
