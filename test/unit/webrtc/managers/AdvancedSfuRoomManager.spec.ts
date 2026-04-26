import os from "node:os";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import { container } from "../../../../src/container/DIContainer.js";
import { LOGGER_TOKEN } from "../../../../src/logger/LoggerContract.js";
import {
  WEBRTC_ROOM_CREATED_EVENT,
  WEBRTC_WORKER_LOAD_EVENT,
  WEBRTC_ROOM_CLOSED_EVENT,
} from "../../../../src/webrtc/constants/WebRtcEvents.js";
import { AdvancedSfuRoomManager } from "../../../../src/webrtc/managers/AdvancedSfuRoomManager.js";

// Simulamos el EventBus del framework
const mockEmit = vi.fn();
vi.mock("../../../../src/events/eventbus.factory.js", () => ({
  getEventBus: vi.fn(() => ({
    emit: mockEmit,
  })),
}));

// Simulamos la configuración y constantes
vi.mock("../../../../src/webrtc/constants/WebRtcConfig.js", () => ({
  DEFAULT_ROUTER_OPTIONS: { appData: {} },
  DEFAULT_WORKER_SETTINGS: {},
  getAudioLevelObserverOptions: vi.fn(() => ({})),
  getWebRtcServerOptions: vi.fn(() => ({})),
}));

// Simulamos la API completa de Mediasoup
const mockAudioObserverOn = vi.fn();
const mockRouterOn = vi.fn();
const mockRouterClose = vi.fn();
let mockCpuUsage = { ru_utime: 100, ru_stime: 50 }; // Tiempo base de CPU
let pidCounter = 1000; // Para generar PIDs únicos en los workers simulados

vi.mock("mediasoup", () => ({
  createWorker: vi.fn().mockImplementation(async ({ appData }) => {
    await Promise.resolve(); // Simulamos async real
    const pid = pidCounter++;
    return {
      pid,
      appData: { ...appData, webRtcServer: { id: `server-${pid}` } },
      on: vi.fn(), // Para atrapar eventos como "died"
      close: vi.fn(),
      getResourceUsage: vi.fn().mockResolvedValue(mockCpuUsage),
      createWebRtcServer: vi.fn().mockResolvedValue({ id: `server-${pid}` }),
      createRouter: vi.fn().mockImplementation(async (opts) => {
        await Promise.resolve(); // Simulamos async real
        return {
          id: `router-${Math.random()}`,
          appData: opts.appData,
          createAudioLevelObserver: vi.fn().mockResolvedValue({
            on: mockAudioObserverOn, // Para el evento "volumes"
          }),
          on: mockRouterOn, // Para el evento "workerclose"
          close: mockRouterClose,
        };
      }),
    };
  }),
}));

describe("Gestor de Salas Avanzado (Distribución por carga de CPU)", () => {
  let manager: AdvancedSfuRoomManager;

  // Antes de cada test, reiniciamos los mocks y creamos una nueva instancia del manager
  beforeEach(() => {
    vi.clearAllMocks();

    // Simulamos un sistema con 2 núcleos de CPU para probar el balanceo
    vi.spyOn(os, "cpus").mockReturnValue([{}, {}] as any);

    // Registramos un logger simulado en el contenedor para evitar errores de dependencia
    container.registerInstance(LOGGER_TOKEN, {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
    });

    // Reiniciamos el contador de PIDs para cada test para predecir los valores
    pidCounter = 1000;
    // Configuramos un uso base de CPU para las pruebas de carga
    mockCpuUsage = { ru_utime: 100, ru_stime: 50 };
    // Creamos una nueva instancia del manager para cada test
    manager = new AdvancedSfuRoomManager();

    // Simulamos el paso del tiempo manualmente para las métricas de carga
    vi.useFakeTimers();
  });

  // Después de cada test, restauramos los timers y cualquier mock que pueda afectar a otros tests
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("Debería inicializar exactamente un worker por núcleo de CPU (2 núcleos)", async () => {
    await manager.onApplicationBootstrap();
    const workers = (manager as any).workers;

    expect(workers.length).toBe(2);
    expect(workers[0].pid).toBe(1000);
    expect(workers[1].pid).toBe(1001);
  });

  it("Debería elegir el worker con menor carga de CPU (Balanceo Térmico)", async () => {
    await manager.onApplicationBootstrap();

    const workers = (manager as any).workers;
    const workerLoads = (manager as any).workerLoads;

    // Simulamos agresivamente que el Worker 0 (PID 1000) está al 90% de CPU
    workerLoads.set(workers[0].pid, 90);
    // Y el Worker 1 (PID 1001) está libre al 5%
    workerLoads.set(workers[1].pid, 5);

    // Creamos una sala
    const router = await manager.getOrCreateRoom("room-1");

    // La lógica de getOptimalWorker debería haber asignado la sala al Worker 1
    expect(router.appData.workerPid).toBe(workers[1].pid);
  });

  it("Debería emitir el evento WEBRTC_ROOM_CREATED_EVENT al crear una sala", async () => {
    await manager.onApplicationBootstrap();

    await manager.getOrCreateRoom("test-room-events");

    expect(mockEmit).toHaveBeenCalledWith(
      WEBRTC_ROOM_CREATED_EVENT,
      expect.objectContaining({
        roomId: "test-room-events",
        workerPid: expect.any(Number),
      }),
    );
  });

  it("Debería calcular la carga periódica de CPU y emitir WEBRTC_WORKER_LOAD_EVENT", async () => {
    await manager.onApplicationBootstrap();

    // Asignamos una sala para que tenga "activeRooms" que contar
    await manager.getOrCreateRoom("room-load-test");

    // Llamada 1: Establece el snapshot inicial de tiempo
    await manager.calculateWorkersLoad();

    // Avanzamos el reloj de Node.js 5 segundos hacia el futuro
    vi.advanceTimersByTime(5000);

    // Simulamos que el uso de CPU (en C++) aumentó mientras pasaban los 5 segs
    mockCpuUsage = { ru_utime: 300, ru_stime: 150 };

    // Llamada 2: Calcula la diferencia (delta) y emite el evento
    await manager.calculateWorkersLoad();

    expect(mockEmit).toHaveBeenCalledWith(
      WEBRTC_WORKER_LOAD_EVENT,
      expect.objectContaining({
        workers: expect.arrayContaining([
          expect.objectContaining({
            pid: expect.any(Number),
            cpuUsage: expect.any(Number),
            activeRooms: expect.any(Number), // Debería ser 1 para uno de los workers
          }),
        ]),
      }),
    );
  });

  it("Debería recuperar automáticamente la capacidad si un worker muere (Self-Healing)", async () => {
    await manager.onApplicationBootstrap();

    const workersAntes = [...(manager as any).workers];
    const workerMuerto = workersAntes[0];

    // Forzamos el método de muerte del worker (como si mediasoup lanzara "died")
    await (manager as any).handleWorkerDeath(workerMuerto, 0);

    const workersDespues = (manager as any).workers;

    // Verificamos que el sistema sigue teniendo 2 workers (se recuperó la capacidad)
    expect(workersDespues.length).toBe(2);

    // El worker muerto ya no debería estar en la lista
    expect(workersDespues.some((w: any) => w.pid === workerMuerto.pid)).toBe(
      false,
    );

    // Un worker nuevo debió haberse creado con un PID nuevo (1002)
    expect(workersDespues.some((w: any) => w.pid === 1002)).toBe(true);

    // La carga del nuevo worker debería haberse reiniciado a 0
    expect((manager as any).workerLoads.get(1002)).toBe(0);
  });

  it("Debería cerrar los routers y emitir WEBRTC_ROOM_CLOSED_EVENT al eliminar una sala", async () => {
    await manager.onApplicationBootstrap();
    await manager.getOrCreateRoom("room-to-delete");

    // Limpiamos los mocks de emisiones previas (como la creación de la sala)
    mockEmit.mockClear();

    // Eliminamos la sala
    manager.removeRoom("room-to-delete");

    expect(mockRouterClose).toHaveBeenCalled(); // Se llamó router.close()
    expect(mockEmit).toHaveBeenCalledWith(WEBRTC_ROOM_CLOSED_EVENT, {
      roomId: "room-to-delete",
    });
    expect(manager.hasRoom("room-to-delete")).toBe(false); // Ya no existe en el Map
  });

  it("Debería lanzar un error si se intenta crear una sala sin workers disponibles", async () => {
    // No llamamos a onApplicationBootstrap, por lo que el array de workers está vacío
    await expect(manager.getOrCreateRoom("fail-room")).rejects.toThrow();
  });

  it("Debería cerrar todos los workers al apagar la aplicación", async () => {
    await manager.onApplicationBootstrap();
    const workers = [...(manager as any).workers];

    await manager.onApplicationShutdown("SIGINT");

    for (const worker of workers) {
      expect(worker.close).toHaveBeenCalled();
    }
  });

  it("Debería obtener una sala existente y verificar su existencia", async () => {
    await manager.onApplicationBootstrap();
    await manager.getOrCreateRoom("room-existente");

    expect(manager.hasRoom("room-existente")).toBe(true);
    expect(manager.hasRoom("room-falsa")).toBe(false);

    const room = manager.getRoom("room-existente");
    expect(room).toBeDefined();

    expect(() => manager.getRoom("room-falsa")).toThrow();
  });

  it("Debería devolver la cantidad y los IDs de las salas activas", async () => {
    await manager.onApplicationBootstrap();
    await manager.getOrCreateRoom("room-a");
    await manager.getOrCreateRoom("room-b");

    expect(manager.getActiveRoomsCount()).toBe(2);
    expect(manager.getActiveRoomIds()).toEqual(["room-a", "room-b"]);
  });
});
