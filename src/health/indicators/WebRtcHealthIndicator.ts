import { HealthIndicator } from "./HealthIndicator.js";
import type { HealthIndicatorResult } from "../interfaces.js";
import { container } from "../../container/DIContainer.js";
import {
  SFU_ROOM_MANAGER_TOKEN,
  type SfuRoomManager,
} from "../../webrtc/interfaces/SfuRoomManager.js";
import { AdvancedSfuRoomManager } from "../../webrtc/managers/AdvancedSfuRoomManager.js";

export class WebRtcHealthIndicator extends HealthIndicator {
  async check(key: string = "webrtc"): Promise<HealthIndicatorResult> {
    if (!container.has(SFU_ROOM_MANAGER_TOKEN)) {
      return this.getStatus(key, false, {
        error:
          "El SfuRoomManager no está registrado en el contenedor de dependencias",
      });
    }

    // Resolvemos el manager de salas WebRTC desde el contenedor de dependencias
    const manager = container.resolve(SFU_ROOM_MANAGER_TOKEN) as SfuRoomManager;
    // Obtenemos el nombre de la clase del manager para incluirlo en los detalles del resultado de salud
    const managerName = (manager as object).constructor.name;

    // Evaluamos la salud del manager de salas WebRTC.
    const activeRooms = manager.getActiveRoomsCount();
    let isHealthy = true;
    let details: Record<string, unknown> = {
      managerType: managerName,
      activeRooms,
    };

    // Si el manager es una instancia de AdvancedSfuRoomManager, verificamos el estado de los workers y su carga.
    if (manager instanceof AdvancedSfuRoomManager) {
      // Usamos un cast estructural para acceder a miembros privados sin usar 'any'
      const internal = manager as unknown as {
        workers: unknown[];
        workerLoads: Map<number, number>;
      };

      const workersAlive = internal.workers?.length || 0;
      const loads = Array.from(internal.workerLoads.values());
      const avgLoad =
        workersAlive > 0 ? loads.reduce((a, b) => a + b, 0) / workersAlive : 0;

      isHealthy = workersAlive > 0;
      details = {
        ...details,
        workersAlive,
        avgCpuLoad: `${avgLoad.toFixed(2)}%`,
        ...(workersAlive === 0
          ? { error: "No Mediasoup workers available" }
          : {}),
      };
    }
    // Si el manager tiene un método checkHealth personalizado, lo utilizamos para obtener un estado de salud más detallado.
    else if (
      typeof (manager as { checkHealth?: unknown }).checkHealth === "function"
    ) {
      const customHealth = await (
        manager as unknown as {
          checkHealth: () => Promise<{
            status: boolean;
            details: Record<string, unknown>;
          }>;
        }
      ).checkHealth();

      isHealthy = customHealth.status;
      details = { ...details, ...customHealth.details };
    }

    return this.getStatus(key, isHealthy, details);
  }
}
