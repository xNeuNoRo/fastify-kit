import os from "node:os";
import type {
  Worker as MediasoupWorker,
  Router,
  RouterOptions,
  WebRtcServer,
} from "mediasoup/types";
import { Injectable } from "../../container/injectable.decorator.js";
import { Scheduled } from "../../scheduling/scheduled.decorator.js";
import type {
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "../../core/interfaces/lifecycle.interface.js";
import type { SfuRoomManager } from "../interfaces/SfuRoomManager.js";
import { getLogger } from "../../logger/logger.factory.js";
import {
  DEFAULT_ROUTER_OPTIONS,
  DEFAULT_WORKER_SETTINGS,
  getAudioLevelObserverOptions,
  getWebRtcServerOptions,
} from "../constants/WebRtcConfig.js";
import {
  WEBRTC_AUDIO_VOLUMES_EVENT,
  WEBRTC_AUDIO_VOLUMES_PAYLOAD,
  WEBRTC_ROOM_CLOSED_EVENT,
  WEBRTC_ROOM_CREATED_EVENT,
  WEBRTC_SYSTEM_SATURATED_EVENT,
  WEBRTC_SYSTEM_SATURATED_PAYLOAD,
  WEBRTC_WORKER_LOAD_EVENT,
  WEBRTC_WORKER_LOAD_PAYLOAD,
} from "../constants/WebRtcEvents.js";
import { getEventBus } from "../../events/eventbus.factory.js";
import { InternalConfig } from "../../config/InternalConfig.js";

type WorkerAppData = {
  workerIndex: number;
  webRtcServer?: WebRtcServer;
};

@Injectable()
export class AdvancedSfuRoomManager
  implements SfuRoomManager, OnApplicationBootstrap, OnApplicationShutdown
{
  // Pool de workers de mediasoup para manejar múltiples routers y distribuir la carga
  private workers: MediasoupWorker<WorkerAppData>[] = [];
  private readonly routers = new Map<string, Router>();
  private readonly logger = getLogger();
  private readonly eventBus = getEventBus();
  // Diccionario para manejar la creación concurrente de salas y evitar race conditions
  private readonly pendingRooms = new Map<string, Promise<Router>>();

  // Map para llevar un seguimiento de la carga de cada worker (número de routers activos)
  private readonly workerLoads = new Map<number, number>();
  private readonly previousSnapshot = new Map<
    number,
    { timestamp: number; cpuTime: number }
  >();
  // Map para llevar un seguimiento de qué salas están alojadas en cada worker (para métricas y balanceo)
  private readonly workerRoomBundles = new Map<number, Set<string>>();
  // Porcentaje de CPU a partir del cual consideramos que el sistema está saturado
  private readonly SATURATION_THRESHOLD =
    InternalConfig.get("webrtc")?.saturationThreshold || 90;

  /**
   * @description Inicializa el gestor avanzado de salas SFU creando un pool de workers de mediasoup
   * basado en la cantidad de núcleos de CPU disponibles. Cada worker se configura con opciones optimizadas
   * para producción y se monitorea su carga para distribuir las salas de manera eficiente.
   */
  async onApplicationBootstrap(): Promise<void> {
    const cpuCount = os.cpus().length;
    this.logger.info(
      `[FastifyKit WebRTC] Inicializando el gestor avanzado de salas SFU con ${cpuCount} workers basados en la cantidad de núcleos de CPU disponibles.`,
    );

    const workerPromises: Promise<MediasoupWorker<WorkerAppData>>[] = [];
    for (let i = 0; i < cpuCount; i++) {
      workerPromises.push(this.createWorker(i));
    }

    this.workers = await Promise.all(workerPromises);
    for (const worker of this.workers) this.workerLoads.set(worker.pid, 0);

    this.logger.info(
      `[FastifyKit WebRTC] Gestor avanzado de salas SFU inicializado con éxito. Se esta monitoreando la carga de ${this.workers.length} workers para distribuir las salas de manera eficiente.`,
    );
  }

  /**
   * @description Cierra ordenadamente todos los workers de mediasoup al apagar la aplicación,
   * liberando recursos y asegurando un cierre limpio del gestor avanzado de salas SFU.
   * @param signal La señal que causó el apagado (opcional), útil para loguear el motivo del cierre.
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.info(
      `[FastifyKit WebRTC] Apagando el gestor avanzado de salas SFU debido a la señal: ${signal || "desconocida"}. Cerrando ordenadamente todos los workers de mediasoup para liberar recursos.`,
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

    // Limpiar el estado interno del gestor para asegurar un cierre limpio
    this.workers = [];
    this.routers.clear();
    this.pendingRooms.clear();
    this.workerLoads.clear();
    this.previousSnapshot.clear();
    this.workerRoomBundles.clear();

    this.logger.info(
      `[FastifyKit WebRTC] Estado interno del gestor avanzado limpiado completamente.`,
    );
  }

  /**
   * @description Crea un nuevo worker de mediasoup con configuraciones optimizadas para producción,
   * asignándole un índice para su identificación y configurando un servidor WebRTC asociado.
   * Además, se establece un listener para detectar si el worker muere inesperadamente
   * y así iniciar un proceso de recuperación automática (Self-Healing).
   * @param index El índice del worker que se está creando, utilizado para su identificación y logueo.
   * @returns El worker de mediasoup recién creado, listo para manejar routers y salas SFU.
   */
  private async createWorker(
    index: number,
  ): Promise<MediasoupWorker<WorkerAppData>> {
    try {
      const { createWorker: createMediasoupWorker } = await import("mediasoup");

      const worker = await createMediasoupWorker<WorkerAppData>({
        ...DEFAULT_WORKER_SETTINGS,
        appData: {
          workerIndex: index,
        },
      });

      // Inicializamos su seguimiento de salas en un Set vacío para que pueda empezar a recibir salas
      this.workerRoomBundles.set(worker.pid, new Set());

      worker.on("died", () => this.handleWorkerDeath(worker, index));

      const webRtcServer = await worker.createWebRtcServer(
        getWebRtcServerOptions(),
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
   * @description Maneja la muerte inesperada de un worker de mediasoup, removiéndolo del pool de workers activos,
   * purgando sus métricas de carga y levantando un nuevo worker de reemplazo para mantener la capacidad del sistema.
   * @param deadWorker El worker de mediasoup que ha muerto y necesita ser reemplazado.
   * @param index El índice del worker que ha muerto, utilizado para loguear el proceso de recuperación y asignar el nuevo worker.
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

    // Purgamos todas las metricas del worker muerto
    this.workerLoads.delete(deadWorker.pid);
    this.previousSnapshot.delete(deadWorker.pid);
    this.workerRoomBundles.delete(deadWorker.pid);

    try {
      // Levantamos un reemplazo para mantener la capacidad del sistema
      const newWorker = await this.createWorker(index);
      this.workers.push(newWorker);

      // Inicializamos su seguimiento de salas en un Set vacío para que pueda empezar a recibir salas
      this.workerRoomBundles.set(newWorker.pid, new Set());

      // Inicializamos su carga en 0 para que pueda empezar a recibir salas
      this.workerLoads.set(newWorker.pid, 0);

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
   * @description Tarea programada que se ejecuta cada 5 segundos para calcular la carga de cada worker de mediasoup
   * basada en el tiempo de CPU utilizado en comparación con el tiempo transcurrido desde la última medición.
   * Esta información se utiliza para distribuir las salas de manera eficiente entre los workers,
   * asignando nuevas salas al worker con menor carga.
   * @returns
   */
  @Scheduled("*/5 * * * * *")
  public async calculateWorkersLoad(): Promise<void> {
    // Si no hay workers, no hay nada que calcular
    if (this.workers.length === 0) return;

    const now = Date.now();

    for (const worker of this.workers) {
      try {
        const usage = await worker.getResourceUsage();
        const currentCpuTime = usage.ru_utime + usage.ru_stime;
        const prev = this.previousSnapshot.get(worker.pid);

        if (prev) {
          // Calculamos la carga del worker como el porcentaje de CPU utilizado en el intervalo de tiempo
          const deltaCpu = currentCpuTime - prev.cpuTime;
          const deltaWall = now - prev.timestamp;

          // Si el delta de tiempo es mayor a 0, calculamos el porcentaje de CPU utilizado en este intervalo
          if (deltaWall > 0) {
            // El cálculo de uso de CPU se basa en la fórmula: (deltaCpu / deltaWall) * 100 para obtener un porcentaje
            const rawCpuUsage = (deltaCpu / deltaWall) * 100;

            // Aseguramos que el porcentaje de CPU esté entre 0% y 100% para evitar valores erróneos
            const cpuUsagePercent = Math.max(0, Math.min(100, rawCpuUsage));

            // Actualizamos la carga del worker en el map
            this.workerLoads.set(worker.pid, cpuUsagePercent);
          }
        }

        // Guardamos el snapshot actual para la próxima comparación
        this.previousSnapshot.set(worker.pid, {
          timestamp: now,
          cpuTime: currentCpuTime,
        });
      } catch (error) {
        this.logger.warn(
          `[FastifyKit WebRTC] No se pudo leer métricas del PID ${worker.pid}`,
          {
            errorMessage:
              error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    // Emitimos un evento con la carga actual de cada worker para que pueda ser consumido por otros componentes del sistema
    const payload: WEBRTC_WORKER_LOAD_PAYLOAD = {
      workers: this.workers.map((worker) => ({
        pid: worker.pid,
        cpuUsage: this.workerLoads.get(worker.pid) || 0,
        // Contamos cuántos routers de nuestra lista están en este worker
        activeRooms: this.workerRoomBundles.get(worker.pid)?.size || 0,
      })),
    };
    this.eventBus.emit(WEBRTC_WORKER_LOAD_EVENT, payload);
  }

  /**
   * @description Selecciona el worker de mediasoup con la menor carga actual para asignarle nuevas salas SFU,
   * asegurando una distribución eficiente de la carga entre los workers disponibles. Si no hay workers disponibles,
   * lanza un error indicando que no se pueden crear nuevas salas.
   * @returns El worker de mediasoup con la menor carga actual, listo para manejar nuevas salas SFU.
   * Si no hay workers disponibles, se lanza un error.
   */
  private getOptimalWorker(): MediasoupWorker<WorkerAppData> {
    if (this.workers.length === 0)
      throw new Error("No hay workers disponibles.");

    const optimalWorker = this.workers.reduce((prev, curr) => {
      const prevLoad = this.workerLoads.get(prev.pid) ?? 0;
      const currLoad = this.workerLoads.get(curr.pid) ?? 0;
      return prevLoad <= currLoad ? prev : curr;
    }, this.workers[0]);

    // Obtenemos la carga actual del worker óptimo para loguearla al crear una nueva sala
    const optimalLoad = this.workerLoads.get(optimalWorker.pid) ?? 0;

    if (optimalLoad >= this.SATURATION_THRESHOLD) {
      this.logger.warn(
        `[FastifyKit WebRTC] ⚠️ SATURACIÓN CRÍTICA DETECTADA: El worker con menor carga (PID ${optimalWorker.pid}) está al ${optimalLoad.toFixed(2)}% de CPU.`,
        {
          pid: optimalWorker.pid,
          currentLoad: optimalLoad,
          threshold: this.SATURATION_THRESHOLD,
          activeRooms: this.routers.size,
        },
      );

      // Emitimos un evento indicando que el sistema está saturado para que otros
      // componentes puedan reaccionar (ej. denegar nuevas salas, alertar, etc.)
      const payload: WEBRTC_SYSTEM_SATURATED_PAYLOAD = {
        pid: optimalWorker.pid,
        load: optimalLoad,
        timestamp: Date.now(),
      };
      this.eventBus.emit(WEBRTC_SYSTEM_SATURATED_EVENT, payload);
    }

    return optimalWorker;
  }

  // ----------------------------------------------------------------
  // Implementación de los métodos de SfuRoomManager
  // ----------------------------------------------------------------

  /**
   * @description Obtiene una sala SFU existente por su ID o crea una nueva sala si no existe,
   * asignándola al worker de mediasoup con menor carga para asegurar una distribución eficiente.
   * @param roomId El ID de la sala SFU que se desea obtener o crear.
   * @param options Opciones adicionales para la creación del router de la sala, como configuraciones específicas de mediosoup.
   * @returns La sala SFU (router de mediasoup) correspondiente al ID proporcionado, ya sea obtenida o recién creada.
   */
  public async getOrCreateRoom(
    roomId: string,
    options?: Partial<RouterOptions>,
  ): Promise<Router> {
    // Si la sala ya existe, la retornamos directamente
    let router = this.routers.get(roomId);
    if (router) return router;

    // Si no existe, verificar si ya hay una promesa de creación en curso para esta sala (para evitar race conditions)
    const pendingPromise = this.pendingRooms.get(roomId);

    // Si hay una promesa pendiente, significa que otra solicitud ya está creando
    // esta sala, así que esperamos a que se resuelva y retornamos el resultado
    if (pendingPromise) {
      this.logger.debug(
        `[FastifyKit WebRTC] La sala "${roomId}" está en proceso de creación. Esperando...`,
      );
      return pendingPromise;
    }

    const createRoomPromise = async () => {
      try {
        // Si no existe, creamos una nueva sala en el worker óptimo según la carga actual
        const worker = this.getOptimalWorker();
        const currentLoad =
          this.workerLoads.get(worker.pid)?.toFixed(2) || "0.00";

        const finalOptions: RouterOptions = {
          ...DEFAULT_ROUTER_OPTIONS,
          ...options,
          appData: {
            ...DEFAULT_ROUTER_OPTIONS.appData,
            ...(options?.appData || {}),
            webRtcServer: worker.appData.webRtcServer,
            workerPid: worker.pid,
          },
        };

        // Creamos el router en el worker seleccionado y lo guardamos en nuestro map de routers activos
        const newRouter = await worker.createRouter(finalOptions);

        // Emitimos un evento indicando que se ha creado una nueva sala SFU,
        // incluyendo el ID de la sala y el PID del worker que la aloja
        this.eventBus.emit(WEBRTC_ROOM_CREATED_EVENT, {
          roomId,
          workerPid: worker.pid,
        });

        // Creamos un observador de niveles de audio para esta sala y almacenarlo en su appData para uso futuro
        const audioObserver = await newRouter.createAudioLevelObserver(
          getAudioLevelObserverOptions(),
        );

        // Configuramos el manejador para emitir eventos de niveles de audio a través
        // del event bus cada vez que se detecten cambios en los volúmenes de los productores
        audioObserver.on("volumes", (volumes) => {
          const payload: WEBRTC_AUDIO_VOLUMES_PAYLOAD = {
            roomId,
            volumes: volumes.map((v) => ({
              producerId: v.producer.id,
              volume: v.volume,
            })),
          };

          this.eventBus.emit(WEBRTC_AUDIO_VOLUMES_EVENT, payload);
        });

        newRouter.appData.audioLevelObserver = audioObserver;

        this.routers.set(roomId, newRouter);

        // Guardamos el ID de la sala en el Set del worker correspondiente
        // para llevar un seguimiento de qué salas están alojadas en cada worker
        this.workerRoomBundles.get(worker.pid)?.add(roomId);

        this.logger.info(
          `[FastifyKit WebRTC] Sala [${roomId}] creada en el worker PID ${worker.pid} (Carga CPU: ${currentLoad}%)`,
        );

        newRouter.on("workerclose", () => {
          this.logger.warn(
            `[FastifyKit WebRTC] El worker PID ${worker.pid} que alojaba la sala "${roomId}" se ha cerrado. Eliminando sala del gestor...`,
            {
              roomId,
              workerPid: worker.pid,
              routerId: newRouter.id,
            },
          );

          // Al cerrar el worker, eliminamos la sala de nuestro map de routers activos
          const workerPid = newRouter.appData.workerPid;
          this.workerRoomBundles.get(workerPid as number)?.delete(roomId);

          this.eventBus.emit(WEBRTC_ROOM_CLOSED_EVENT, { roomId });
          this.routers.delete(roomId);
        });

        return newRouter;
      } finally {
        // Una vez que se resuelva la creación de la sala, eliminamos la promesa pendiente para ese roomId
        this.pendingRooms.delete(roomId);
      }
    };

    // Iniciamos la promesa, la guardamos en el pending map y la retornamos
    const roomPromise = createRoomPromise();
    this.pendingRooms.set(roomId, roomPromise);
    return roomPromise;
  }

  /**
   * @description Obtiene una sala SFU existente por su ID. Si la sala no existe,
   * se lanza un error indicando que la sala no fue encontrada.
   * @param roomId El ID de la sala SFU que se desea obtener.
   * @returns La sala SFU (router de mediasoup) correspondiente al ID proporcionado. Si la sala no existe, se lanza un error.
   */
  public getRoom(roomId: string): Router {
    const router = this.routers.get(roomId);
    if (!router) throw new Error(`La sala ${roomId} no existe.`);
    return router;
  }

  /**
   * @description Verifica si una sala SFU con el ID proporcionado existe actualmente en el gestor avanzado de salas SFU.
   * @param roomId El ID de la sala SFU que se desea verificar.
   * @returns Un valor booleano indicando si la sala SFU con el ID proporcionado existe (true) o no (false).
   */
  public hasRoom(roomId: string): boolean {
    return this.routers.has(roomId);
  }

  /**
   * @description Elimina una sala SFU existente por su ID, cerrando su router de
   * mediasoup asociado y liberando los recursos correspondientes.
   * @param roomId El ID de la sala SFU que se desea eliminar. Si la sala no existe, no se realiza ninguna acción.
   */
  public removeRoom(roomId: string): void {
    const router = this.routers.get(roomId);
    if (router) {
      router.close();

      // Al cerrar la sala manualmente, la eliminamos de nuestro map de routers activos
      const workerPid = router.appData.workerPid;
      this.workerRoomBundles.get(workerPid as number)?.delete(roomId);

      this.eventBus.emit(WEBRTC_ROOM_CLOSED_EVENT, { roomId });
      this.routers.delete(roomId);
    }
  }

  /**
   * @description Obtiene el número total de salas SFU activas actualmente en el gestor avanzado de salas SFU.
   * @returns El número total de salas SFU activas. Si no hay salas activas, retorna 0.
   */
  public getActiveRoomsCount(): number {
    return this.routers.size;
  }

  /**
   * @description Obtiene una lista con los IDs de todas las salas SFU activas actualmente en el gestor avanzado de salas SFU.
   * @returns Un array de strings con los IDs de todas las salas SFU activas. Si no hay salas activas, retorna un array vacío.
   */
  public getActiveRoomIds(): string[] {
    return Array.from(this.routers.keys());
  }
}
