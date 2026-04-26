import os from "node:os";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import { container } from "../../../../src/container/DIContainer.js";
import { LOGGER_TOKEN } from "../../../../src/logger/LoggerContract.js";
import {
  WEBRTC_ROOM_CREATED_EVENT,
  WEBRTC_ROOM_CLOSED_EVENT,
} from "../../../../src/webrtc/constants/WebRtcEvents.js";
import { DefaultSfuRoomManager } from "../../../../src/webrtc/managers/DefaultSfuRoomManager.js";

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
let pidCounter = 1000;

vi.mock("mediasoup", () => ({
  createWorker: vi.fn().mockImplementation(async ({ appData }) => {
    await Promise.resolve();
    const pid = pidCounter++;
    return {
      pid,
      appData: { ...appData, webRtcServer: { id: `server-${pid}` } },
      on: vi.fn(),
      close: vi.fn(),
      createWebRtcServer: vi.fn().mockResolvedValue({ id: `server-${pid}` }),
      createRouter: vi.fn().mockImplementation(async (opts) => {
        await Promise.resolve();
        return {
          id: `router-${Math.random()}`,
          appData: opts.appData,
          createAudioLevelObserver: vi.fn().mockResolvedValue({
            on: mockAudioObserverOn,
          }),
          on: mockRouterOn,
          close: mockRouterClose,
        };
      }),
    };
  }),
}));

describe("Gestor de Salas por Defecto (Distribución Round-Robin)", () => {
  let manager: DefaultSfuRoomManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(os, "cpus").mockReturnValue([{}, {}, {}] as any); // 3 núcleos para probar rotación

    // Registramos un logger simulado en el contenedor para evitar errores de dependencia
    container.registerInstance(LOGGER_TOKEN, {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
    });

    pidCounter = 1000;
    manager = new DefaultSfuRoomManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Debería inicializar exactamente un worker por núcleo de CPU (3 núcleos)", async () => {
    await manager.onApplicationBootstrap();
    const workers = (manager as any).workers;

    expect(workers.length).toBe(3);
    expect(workers[0].pid).toBe(1000);
    expect(workers[2].pid).toBe(1002);
  });

  it("Debería distribuir las salas usando un algoritmo Round-Robin secuencial", async () => {
    await manager.onApplicationBootstrap();
    const workers = (manager as any).workers;

    // Sala 1 -> Debería ir al Worker 0 (PID 1000)
    const router1 = await manager.getOrCreateRoom("room-1");
    expect(router1.appData.workerPid).toBe(workers[0].pid);

    // Sala 2 -> Debería ir al Worker 1 (PID 1001)
    const router2 = await manager.getOrCreateRoom("room-2");
    expect(router2.appData.workerPid).toBe(workers[1].pid);

    // Sala 3 -> Debería ir al Worker 2 (PID 1002)
    const router3 = await manager.getOrCreateRoom("room-3");
    expect(router3.appData.workerPid).toBe(workers[2].pid);

    // Sala 4 -> Debería VOLVER al Worker 0 (PID 1000) por el módulo (%)
    const router4 = await manager.getOrCreateRoom("room-4");
    expect(router4.appData.workerPid).toBe(workers[0].pid);
  });

  it("Debería emitir el evento WEBRTC_ROOM_CREATED_EVENT al crear una sala", async () => {
    await manager.onApplicationBootstrap();
    await manager.getOrCreateRoom("test-room");

    expect(mockEmit).toHaveBeenCalledWith(
      WEBRTC_ROOM_CREATED_EVENT,
      expect.objectContaining({
        roomId: "test-room",
        workerPid: expect.any(Number),
      }),
    );
  });

  it("Debería recuperar automáticamente la capacidad si un worker muere (Self-Healing)", async () => {
    await manager.onApplicationBootstrap();

    const workersAntes = [...(manager as any).workers];
    const workerMuerto = workersAntes[0];

    // Simulamos la muerte del worker
    await (manager as any).handleWorkerDeath(workerMuerto, 0);

    const workersDespues = (manager as any).workers;

    expect(workersDespues.length).toBe(3);
    expect(workersDespues.some((w: any) => w.pid === workerMuerto.pid)).toBe(
      false,
    );

    // Debería haberse creado un nuevo worker con PID 1003
    expect(workersDespues.some((w: any) => w.pid === 1003)).toBe(true);
  });

  it("Debería cerrar todos los workers y limpiar el estado al apagar la aplicación", async () => {
    await manager.onApplicationBootstrap();
    const workers = [...(manager as any).workers];

    await manager.onApplicationShutdown("SIGTERM");

    for (const worker of workers) {
      expect(worker.close).toHaveBeenCalled();
    }
    expect((manager as any).workers.length).toBe(0);
    expect((manager as any).routers.size).toBe(0);
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

  it("Debería eliminar una sala existente, cerrar el router y emitir el evento correspondiente", async () => {
    await manager.onApplicationBootstrap();
    await manager.getOrCreateRoom("room-to-delete");

    mockEmit.mockClear();

    manager.removeRoom("room-to-delete");

    expect(mockRouterClose).toHaveBeenCalled();
    expect(mockEmit).toHaveBeenCalledWith(WEBRTC_ROOM_CLOSED_EVENT, {
      roomId: "room-to-delete",
    });
    expect(manager.hasRoom("room-to-delete")).toBe(false);
  });

  it("Debería devolver la cantidad y los IDs de las salas activas", async () => {
    await manager.onApplicationBootstrap();
    await manager.getOrCreateRoom("room-a");
    await manager.getOrCreateRoom("room-b");

    expect(manager.getActiveRoomsCount()).toBe(2);
    expect(manager.getActiveRoomIds()).toEqual(["room-a", "room-b"]);
  });
});
