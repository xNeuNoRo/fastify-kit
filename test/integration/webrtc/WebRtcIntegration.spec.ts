import type { FastifyInstance } from "fastify";
import os from "node:os";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

import { container } from "../../../src/container/DIContainer.js";
import { FastifyKit } from "../../../src/core/FastifyKit.js";
import { Module } from "../../../src/core/module.decorator.js";
import { getEventBus } from "../../../src/events/eventbus.factory.js";
import { LOGGER_TOKEN } from "../../../src/logger/LoggerContract.js";
import { WEBRTC_MEDIA_SCORE_EVENT } from "../../../src/webrtc/constants/WebRtcEvents.js";
import { DefaultWebRtcGateway } from "../../../src/webrtc/gateways/DefaultWebRtcGateway.js";
import { SFU_ROOM_MANAGER_TOKEN } from "../../../src/webrtc/interfaces/SfuRoomManager.js";
import { AdvancedSfuRoomManager } from "../../../src/webrtc/managers/AdvancedSfuRoomManager.js";
import { WsBroadcaster } from "../../../src/websockets/broadcaster/WsBroadcaster.js";
import type { FastifyKitSocket } from "../../../src/websockets/interfaces/FastifyKitSocket.js";
import { getRoomManager } from "../../../src/websockets/managers/room-manager.factory.js";

// Mockeamos el transport de WebRTC
let scoreCallback: any;
const mockTransport = {
  id: "trans-integration-1",
  iceParameters: { usernameFragment: "u", password: "p" },
  iceCandidates: [],
  dtlsParameters: { fingerPrints: [] },
  connect: vi.fn(),
  produce: vi.fn().mockImplementation(async ({ kind, appData }) => {
    await Promise.resolve(); // Simulamos async real
    return {
      id: "p1",
      kind,
      appData,
      on: vi.fn((event, cb) => {
        if (event === "score") scoreCallback = cb;
      }),
      close: vi.fn(),
    };
  }),
  consume: vi.fn().mockResolvedValue({
    id: "cons-1",
    kind: "video",
    rtpParameters: {},
    close: vi.fn(),
  }),
  produceData: vi.fn().mockResolvedValue({ id: "dp1", close: vi.fn() }),
  consumeData: vi.fn().mockResolvedValue({
    id: "dc1",
    sctpStreamParameters: {},
    close: vi.fn(),
  }),
  close: vi.fn(),
};

// Mockeamos la funcionalidad de Mediasoup para crear workers y routers
vi.mock("mediasoup", () => ({
  createWorker: vi.fn().mockImplementation(async (settings: any) => {
    await Promise.resolve(); // Simulamos async real
    return {
      pid: 9999,
      appData: settings.appData || {},
      on: vi.fn(),
      close: vi.fn(),
      getResourceUsage: vi
        .fn()
        .mockResolvedValue({ ru_utime: 100, ru_stime: 50 }),
      createWebRtcServer: vi.fn().mockResolvedValue({ id: "server-1" }),
      createRouter: vi.fn().mockImplementation(async (opts: any) => {
        await Promise.resolve(); // Simulamos async real
        return {
          id: "router-1",
          appData: opts.appData || { workerPid: 9999, webRtcServer: {} },
          rtpCapabilities: { codecs: [{ mimeType: "video/VP8" }] },
          canConsume: vi.fn().mockReturnValue(true),
          createAudioLevelObserver: vi.fn().mockResolvedValue({ on: vi.fn() }),
          createWebRtcTransport: vi.fn().mockResolvedValue(mockTransport),
          on: vi.fn(),
          close: vi.fn(),
        };
      }),
    };
  }),
}));

// Simulamos un Modulo vacío (al usar useDefaultGateway: true,
// el módulo del gateway se auto-incluye, así que no necesitamos declarar nada aquí)
@Module({ controllers: [], providers: [] })
class IntegrationAppModule {}

describe("WebRTC Integration End-to-End Slice", () => {
  let app: FastifyInstance;
  let gateway: DefaultWebRtcGateway;
  let mockSocket: FastifyKitSocket;
  let manager: AdvancedSfuRoomManager;
  let broadcasterSpy: WsBroadcaster;

  beforeAll(async () => {
    vi.clearAllMocks();
    vi.spyOn(os, "cpus").mockReturnValue([{}, {}] as any);

    // Inyectamos las dependencias en el contenedor global antes de que FastifyKit se inicialice
    container.registerInstance(LOGGER_TOKEN, {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Pre-instanciamos y arrancamos el Manager para que tenga workers
    manager = new AdvancedSfuRoomManager();
    await manager.onApplicationBootstrap();

    // Lo registramos bajo el Token para que la factory lo encuentre
    container.registerInstance(SFU_ROOM_MANAGER_TOKEN, manager);

    // Arrancamos la App
    app = await FastifyKit.create({
      module: IntegrationAppModule,
      webrtc: {
        useDefaultGateway: true,
        listenIp: "127.0.0.1",
        announcedIp: "192.168.1.100",
        port: 50000,
      },
    });

    await app.ready();

    gateway = container.resolve(DefaultWebRtcGateway);
    broadcasterSpy = container.resolve(WsBroadcaster);

    // Inyectamos el manager directamente en el gateway para asegurarnos de que se usa el mismo mock en las pruebas
    Object.defineProperty(gateway, "roomManager", {
      get: () => manager,
      configurable: true,
    });

    mockSocket = { id: "socket-integration", data: {} } as any;
  });

  // Después de todas las pruebas, cerramos la app y restauramos los mocks
  afterAll(async () => {
    if (app) await app.close();
    vi.restoreAllMocks();
  });

  it("Debería ejecutar el flujo WebRTC completo con inyección de manager exitosa", async () => {
    const ROOM_ID = "integration-room";
    const eventBus = getEventBus();
    const scoreSpy = vi.fn();
    eventBus.on(WEBRTC_MEDIA_SCORE_EVENT, scoreSpy);

    // Preparamos el espía del broadcaster ANTES de las llamadas
    const emitSpy = vi.spyOn(broadcasterSpy, "emitToRoom");

    // Obtenemos las capacidades del Router (Valida que el manager tiene workers)
    const caps = await gateway.onGetRouterCapabilities(mockSocket, {
      roomId: ROOM_ID,
    });
    expect(caps).toBeDefined();
    const firstCodec = caps.codecs?.[0];
    expect(firstCodec).toBeDefined();
    expect(firstCodec?.mimeType).toBe("video/VP8");
    expect(mockSocket.data.sfu?.roomId).toBe(ROOM_ID);

    // Creamos el Transporte
    const transport = await gateway.onCreateTransport(mockSocket, {
      roomId: ROOM_ID,
    });
    expect(transport).toBeDefined();
    expect(transport.iceServers).toBeDefined();
    expect(mockSocket.data.sfu?.transports.has("trans-integration-1")).toBe(
      true,
    );

    // Conectamos el Transporte (Handshake DTLS)
    const connectResult = await gateway.onConnectTransport(mockSocket, {
      transportId: "trans-integration-1",
      dtlsParameters: {} as any,
    });
    expect(connectResult).toEqual({ connected: true });
    expect(mockTransport.connect).toHaveBeenCalled();

    // Producimos Medios (Video)
    const produceResult = await gateway.onProduce(mockSocket, {
      roomId: ROOM_ID,
      transportId: "trans-integration-1",
      kind: "video",
      rtpParameters: {} as any,
    });
    expect(produceResult.id).toBe("p1");
    expect(mockSocket.data.sfu?.producers.has("p1")).toBe(true);

    // Validar broadcasting del nuevo productor a la sala
    expect(emitSpy).toHaveBeenCalledWith(
      expect.any(String),
      ROOM_ID,
      "newProducer",
      expect.objectContaining({ producerId: "p1" }),
      [mockSocket.id],
    );

    // Simular evento de score de Mediasoup y validar EventBus
    if (scoreCallback) scoreCallback([{ score: 10 }]);
    expect(scoreSpy).toHaveBeenCalledWith(
      expect.objectContaining({ producerId: "p1", score: 10 }),
    );

    // Consumimos Medios
    const consumeResult = await gateway.onConsume(mockSocket, {
      roomId: ROOM_ID,
      transportId: "trans-integration-1",
      producerId: "p-remoto",
      rtpCapabilities: {} as any,
    });
    expect(consumeResult.id).toBe("cons-1");
    expect(mockSocket.data.sfu?.consumers.has("cons-1")).toBe(true);

    // Producimos y Consumimos Datos (DataChannels)
    const dataProduceResult = await gateway.onProduceData(mockSocket, {
      transportId: "trans-integration-1",
    });
    expect(dataProduceResult.id).toBe("dp1");
    expect(mockSocket.data.sfu?.dataProducers.has("dp1")).toBe(true);

    // Validar broadcasting del productor de datos
    expect(emitSpy).toHaveBeenCalledWith(
      expect.any(String),
      ROOM_ID,
      "newDataProducer",
      expect.objectContaining({ dataProducerId: "dp1" }),
      [mockSocket.id],
    );

    const dataConsumeResult = await gateway.onConsumeData(mockSocket, {
      transportId: "trans-integration-1",
      dataProducerId: "dp-remoto",
    });
    expect(dataConsumeResult.id).toBe("dc1");
    expect(mockSocket.data.sfu?.dataConsumers.has("dc1")).toBe(true);

    // Limpiamos el gateway para validar la desconexión
    await gateway.handleDisconnect(mockSocket);
    expect(mockSocket.data.sfu?.transports.size).toBe(0);
    expect(mockSocket.data.sfu?.producers.size).toBe(0);

    // Validar notificación de desconexión a la sala
    expect(emitSpy).toHaveBeenCalledWith(
      expect.any(String),
      ROOM_ID,
      "peerClosed",
      expect.objectContaining({ socketId: mockSocket.id }),
      [mockSocket.id],
    );
  });

  it("Debería gestionar correctamente el cambio de sala (join/leave)", async () => {
    const roomManager = getRoomManager();
    const leaveSpy = vi.spyOn(roomManager, "leave");
    const joinSpy = vi.spyOn(roomManager, "join");

    const ROOM_A = "room-a";
    const ROOM_B = "room-b";

    // Unirse a sala A
    await gateway.onGetRouterCapabilities(mockSocket, { roomId: ROOM_A });
    expect(joinSpy).toHaveBeenCalledWith(
      expect.any(String),
      ROOM_A,
      mockSocket.id,
      mockSocket,
    );

    // Cambiar a sala B - debe disparar la salida de la anterior
    await gateway.onGetRouterCapabilities(mockSocket, { roomId: ROOM_B });
    expect(leaveSpy).toHaveBeenCalledWith(
      expect.any(String),
      ROOM_A,
      mockSocket.id,
    );
    expect(joinSpy).toHaveBeenCalledWith(
      expect.any(String),
      ROOM_B,
      mockSocket.id,
      mockSocket,
    );
  });
});
