import os from "node:os";
import { createWorker as createMediasoupWorker } from "mediasoup";
import {
  Worker as MediasoupWorker,
  Router,
  RouterOptions,
  WebRtcServer,
} from "mediasoup/types";
import { Injectable } from "../../container/injectable.decorator.js";
import {
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "../../core/interfaces/lifecycle.interface.js";
import { SfuRoomManager } from "../interfaces/SfuRoomManager.js";
import { getLogger } from "../../logger/logger.factory.js";
import {
  DEFAULT_ROUTER_OPTIONS,
  DEFAULT_WEBRTC_SERVER_OPTIONS,
  DEFAULT_WORKER_SETTINGS,
} from "../constants/WebRtcConfig.js";

// Tipo de datos para almacenar en los workers de mediasoup en esta impl.
type WorkerAppData = {
  workerIndex: number;
  webRtcServer?: WebRtcServer;
};

@Injectable()
export class DefaultSfuRoomManager
  implements SfuRoomManager, OnApplicationBootstrap, OnApplicationShutdown
{
  // Array de workers de C++ (mediasoup) activos
  private workers: MediasoupWorker<WorkerAppData>[] = [];
  // Indice para asignar workers de forma round-robin
  private nextWorkerIndex = 0;
  // Diccionario en memoria de las rooms activas
  private readonly routers = new Map<string, Router>();
  // Logger para depuración
  private readonly logger = getLogger();

  /**
   * @description Maneja la lógica de arranque de la aplicación, creando un pool de workers de mediasoup basado en
   * la cantidad de núcleos de CPU disponibles para maximizar el rendimiento del sistema.
   */
  async onApplicationBootstrap(): Promise<void> {
    const cpuCount = os.cpus().length;
    this.logger.info(
      `[FastifyKit WebRTC] Inicializando el gestor de salas SFU con ${cpuCount} workers basados en la cantidad de núcleos de CPU disponibles.`,
    );

    // Crear un worker por cada núcleo de CPU para aprovechar al máximo el rendimiento
    const workerPromises: Promise<MediasoupWorker<WorkerAppData>>[] = [];
    for (let i = 0; i < cpuCount; i++) {
      workerPromises.push(this.createWorker(i));
    }

    // Esperar a que todos los workers estén listos antes de continuar
    this.workers = await Promise.all(workerPromises);

    this.logger.info(
      `[FastifyKit WebRTC] Gestor de salas SFU inicializado con ${this.workers.length} workers activos.`,
    );
  }

  /**
   * @description Maneja la lógica de apagado de la aplicación, cerrando ordenadamente todos los workers de mediasoup
   * para liberar recursos y evitar fugas de memoria. Este método se ejecuta automáticamente cuando la aplicación
   * recibe una señal de apagado (como SIGINT o SIGTERM).
   * @param signal La señal que causó el apagado de la aplicación, útil para loguear el motivo del cierre.
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.info(
      `[FastifyKit WebRTC] Aplicación apagándose con señal: ${signal} - cerrando ${this.workers.length} workers de mediasoup...`,
    );

    // Cerrar cada worker de mediasoup de forma ordenada
    for (const worker of this.workers) {
      try {
        worker.close();
      } catch (error) {
        this.logger.error(
          `[FastifyKit WebRTC] Error al cerrar worker de mediasoup: ${error}`,
        );
      }
    }

    // Limpiar el estado interno del gestor de salas
    this.workers = [];
    this.routers.clear();

    this.logger.info(
      `[FastifyKit WebRTC] Gestor de salas SFU apagado completamente.`,
    );
  }

  /**
   * @description Crea un nuevo worker de mediasoup con la configuración predeterminada y le asigna un índice para su identificación.
   * También configura un manejador para detectar si el worker muere inesperadamente y así intentar recuperarlo automáticamente (Self-Healing).
   * @param index El índice asignado a este worker para su identificación y recuperación en caso de muerte.
   * @returns Una promesa que resuelve con el worker de mediasoup creado.
   */
  private async createWorker(
    index: number,
  ): Promise<MediasoupWorker<WorkerAppData>> {
    try {
      const worker = await createMediasoupWorker<WorkerAppData>({
        ...DEFAULT_WORKER_SETTINGS,
        appData: {
          workerIndex: index,
        },
      });

      worker.on("died", () => this.handleWorkerDeath(worker, index));

      const webRtcServer = await worker.createWebRtcServer(
        DEFAULT_WEBRTC_SERVER_OPTIONS,
      );
      worker.appData.webRtcServer = webRtcServer;

      return worker;
    } catch (error) {
      this.logger.error(
        `[FastifyKit WebRTC] Error instanciando worker de mediasoup: ${error}`,
      );
      throw error;
    }
  }

  /**
   * @description Maneja la muerte inesperada de un worker de mediasoup, intentando recuperarlo automáticamente para mantener la estabilidad del sistema (Self-Healing).
   * @param deadWorker El worker de mediasoup que ha muerto.
   * @param index El índice asignado a ese worker para su identificación y recuperación.
   */
  private async handleWorkerDeath(
    deadWorker: MediasoupWorker<WorkerAppData>,
    index: number,
  ): Promise<void> {
    this.logger.error(
      `[FastifyKit WebRTC] Worker PID ${deadWorker.pid} ha muerto. Iniciando recuperación (Self-Healing)...`,
    );

    // Lo sacamos de nuestro array de workers activos
    this.workers = this.workers.filter((w) => w.pid !== deadWorker.pid);

    try {
      // Levantamos un reemplazo para mantener la capacidad del sistema
      const newWorker = await this.createWorker(index);
      this.workers.push(newWorker);
      this.logger.info(
        `[FastifyKit WebRTC] Worker recuperado exitosamente. Nuevo PID: ${newWorker.pid} (Índice ${index}).`,
      );
    } catch (error) {
      // Si falla la recuperación, lo logueamos como un error crítico
      this.logger.error(
        `[FastifyKit WebRTC] Fallo crítico intentando recuperar el worker ${index}: ${error}`,
      );
    }
  }

  /**
   * @description Selecciona el siguiente worker de mediasoup de forma round-robin para distribuir la carga de las salas (routers) de manera equilibrada.
   * @returns El worker de mediasoup seleccionado para alojar la próxima sala (router) a crear.
   */
  private getOptimalWorker(): MediasoupWorker<WorkerAppData> {
    if (this.workers.length === 0)
      throw new Error("No hay workers de WebRTC disponibles.");
    const worker = this.workers[this.nextWorkerIndex];
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
    return worker;
  }

  // ----------------------------------------------------------------
  // Implementación de los métodos de SfuRoomManager
  // ----------------------------------------------------------------

  /**
   * @description Obtiene una sala (router) existente por su ID o crea una nueva si no existe.
   * @param roomId El identificador único de la sala a obtener o crear.
   * @param options Opciones de configuración para la creación del router si la sala no existe. Estas opciones se combinan con los valores predeterminados.
   * @returns Una promesa que resuelve con el router de la sala obtenida o creada.
   */
  public async getOrCreateRoom(
    roomId: string,
    options?: Partial<RouterOptions>,
  ): Promise<Router> {
    // Verificar si la sala ya existe en el diccionario
    let router = this.routers.get(roomId);

    // Si existe, retornarla inmediatamente
    if (router) return router;

    // Si no existe, crear una nueva sala (router) en un worker óptimo
    const worker = this.getOptimalWorker();

    const finalOptions: RouterOptions = {
      ...DEFAULT_ROUTER_OPTIONS,
      ...options,
      appData: {
        ...DEFAULT_ROUTER_OPTIONS.appData,
        ...(options?.appData || {}),
        webRtcServer: worker.appData.webRtcServer,
      },
    };

    // Crear el router en el worker seleccionado y almacenarlo en el diccionario
    router = await worker.createRouter(finalOptions);
    this.routers.set(roomId, router);

    this.logger.info(
      `[FastifyKit WebRTC] Sala "${roomId}" creada en worker PID ${worker.pid}`,
      {
        roomId,
        workerPid: worker.pid,
        routerId: router.id,
        finalOptions,
      },
    );

    router.on("workerclose", () => {
      this.logger.warn(
        `[FastifyKit WebRTC] El worker PID ${worker.pid} que alojaba la sala "${roomId}" se ha cerrado. Eliminando sala del gestor...`,
        {
          roomId,
          workerPid: worker.pid,
          routerId: router.id,
        },
      );
      this.routers.delete(roomId);
    });

    return router;
  }

  /**
   * @description Obtiene una sala (router) existente por su ID.
   * @param roomId El identificador único de la sala a obtener.
   * @returns El router de la sala si existe.
   */
  public getRoom(roomId: string): Router {
    const router = this.routers.get(roomId);
    if (!router) {
      this.logger.warn(
        `[FastifyKit WebRTC] Intento de obtener sala "${roomId}" que no existe.`,
        { roomId },
      );
      throw new Error(`La sala con ID "${roomId}" no existe.`);
    }
    return router;
  }

  /**
   * @description Verifica si una sala (router) existe por su ID.
   * @param roomId El identificador único de la sala a verificar.
   * @returns true si la sala existe, false en caso contrario.
   */
  public hasRoom(roomId: string): boolean {
    return this.routers.has(roomId);
  }

  /**
   * @description Elimina una sala (router) existente por su ID, cerrando sus recursos asociados.
   * @param roomId El identificador único de la sala a eliminar.
   */
  public removeRoom(roomId: string): void {
    const router = this.routers.get(roomId);
    if (router) {
      router.close();
      this.routers.delete(roomId);
      this.logger.info(
        `[FastifyKit WebRTC] Sala "${roomId}" eliminada manualmente.`,
        { roomId },
      );
    }
  }

  /**
   * @description Obtiene la cantidad total de salas (routers) activas actualmente en el gestor.
   * @returns El número de salas activas.
   */
  public getActiveRoomsCount(): number {
    return this.routers.size;
  }

  /**
   * @description Obtiene una lista de los identificadores de las salas (routers) activas actualmente en el gestor.
   * @returns Un array de strings con los IDs de las salas activas.
   */
  public getActiveRoomIds(): string[] {
    return Array.from(this.routers.keys());
  }
}
