import { container } from "../../container/DIContainer.js";
import {
  SFU_ROOM_MANAGER_TOKEN,
  type SfuRoomManager,
} from "../interfaces/SfuRoomManager.js";

/**
 * @description Factory para obtener el gestor de salas SFU activo.
 * Resuelve el manager desde el contenedor de dependencias.
 * * Nota: El registro y la inicialización (bootstrap) del manager ocurren
 * automáticamente en el core de FastifyKit siempre que la opción 'webrtc' esté activa.
 */
export function getSfuRoomManager(): SfuRoomManager {
  if (!container.has(SFU_ROOM_MANAGER_TOKEN)) {
    throw new Error(
      "[FastifyKit WebRTC] El SfuRoomManager no ha sido registrado en el contenedor. " +
        "Por favor, asegúrate de activar la opción 'webrtc' en FastifyKit.create() " +
        "para que el gestor de salas se registre y se inicialice correctamente antes de su uso." +
        "O registra tu propio SfuRoomManager personalizado en el contenedor con el token SFU_ROOM_MANAGER_TOKEN" +
        "si deseas usar una implementación personalizada.",
    );
  }

  return container.resolve<SfuRoomManager>(SFU_ROOM_MANAGER_TOKEN);
}
