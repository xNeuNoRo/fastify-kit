import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

import { container } from "../../../../src/container/DIContainer.js";
import * as eventbusFactory from "../../../../src/events/eventbus.factory.js";
import * as loggerFactory from "../../../../src/logger/logger.factory.js";
import * as webrtcConfig from "../../../../src/webrtc/constants/WebRtcConfig.js";
import { WEBRTC_MEDIA_SCORE_EVENT } from "../../../../src/webrtc/constants/WebRtcEvents.js";
import { DefaultWebRtcGateway } from "../../../../src/webrtc/gateways/DefaultWebRtcGateway.js";
import * as sfuManagerFactory from "../../../../src/webrtc/managers/sfu-manager.factory.js";
import { WsBroadcaster } from "../../../../src/websockets/broadcaster/WsBroadcaster.js";
import type { FastifyKitSocket } from "../../../../src/websockets/interfaces/FastifyKitSocket.js";
import * as roomManagerFactory from "../../../../src/websockets/managers/room-manager.factory.js";

// Guardamos el callback de score para simularlo en las pruebas
let scoreCallback: any;

// Mockeamos el productor de medios
const mockProducer = {
  id: "prod-1",
  kind: "video",
  appData: { custom: "data" },
  on: vi.fn((event, cb) => {
    if (event === "score") scoreCallback = cb;
  }),
  close: vi.fn(),
};

// Mockeamos el consumidor de medios
const mockConsumer = {
  id: "cons-1",
  kind: "video",
  rtpParameters: {},
  close: vi.fn(),
};

// Mockeamos el productor de datos
const mockDataProducer = { id: "dprod-1", appData: {}, close: vi.fn() };

// Mockeamos el consumidor de datos
const mockDataConsumer = {
  id: "dcons-1",
  sctpStreamParameters: {},
  close: vi.fn(),
};

// Mockeamos el transport de WebRTC
const mockTransport = {
  id: "trans-1",
  iceParameters: { usernameFragment: "user", password: "pwd" },
  iceCandidates: [],
  dtlsParameters: {},
  connect: vi.fn(),
  produce: vi.fn().mockResolvedValue(mockProducer),
  consume: vi.fn().mockResolvedValue(mockConsumer),
  produceData: vi.fn().mockResolvedValue(mockDataProducer),
  consumeData: vi.fn().mockResolvedValue(mockDataConsumer),
  close: vi.fn(),
};

// Mockeamos el router de Mediasoup
const mockRouter = {
  rtpCapabilities: { codecs: [{ mimeType: "video/VP8" }] },
  createWebRtcTransport: vi.fn().mockResolvedValue(mockTransport),
  canConsume: vi.fn().mockReturnValue(true),
  appData: { webRtcServer: {} },
};

// Mockeamos la funcionalidad de Mediasoup para crear workers y routers
vi.mock("mediasoup", () => ({
  createWorker: vi.fn(),
}));

describe("Gateway por defecto para WebRTC (DefaultWebRtcGateway)", () => {
  // Variables para reutilizar en las pruebas
  let gateway: DefaultWebRtcGateway;
  let mockSocket: FastifyKitSocket;
  let mockEmit: any;
  let mockWsRoomManager: any;
  let mockBroadcaster: any;

  // Antes de cada test, reiniciamos los mocks y creamos una nueva instancia del gateway
  beforeEach(() => {
    vi.clearAllMocks();
    scoreCallback = undefined;

    vi.spyOn(loggerFactory, "getLogger").mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      fatal: vi.fn(),
    } as any);

    mockEmit = vi.fn();
    vi.spyOn(eventbusFactory, "getEventBus").mockReturnValue({
      emit: mockEmit,
    } as any);

    mockWsRoomManager = {
      join: vi.fn(),
      leave: vi.fn(),
      leaveAll: vi.fn(),
      emitToRoom: vi.fn(),
      getRooms: vi.fn(),
    };
    vi.spyOn(roomManagerFactory, "getRoomManager").mockReturnValue(
      mockWsRoomManager,
    );

    vi.spyOn(sfuManagerFactory, "getSfuRoomManager").mockReturnValue({
      getRoom: vi.fn().mockReturnValue(mockRouter),
      getOrCreateRoom: vi.fn().mockResolvedValue(mockRouter),
    } as any);

    vi.spyOn(webrtcConfig, "getIceServers").mockReturnValue([
      { urls: "stun:mock" },
    ] as any);
    vi.spyOn(webrtcConfig, "getSimulcastEncodings").mockReturnValue([
      { rid: "r0" },
    ] as any);
    vi.spyOn(webrtcConfig, "getScreenSharingEncodings").mockReturnValue(
      [] as any,
    );

    mockBroadcaster = { emitToRoom: vi.fn(), emitToRooms: vi.fn() };
    container.registerInstance(WsBroadcaster, mockBroadcaster);

    gateway = new DefaultWebRtcGateway();

    mockSocket = {
      id: "socket-123",
      data: {},
    } as unknown as FastifyKitSocket;
  });

  // Después de cada test, restauramos los mocks para evitar interferencias entre pruebas
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Obtención de Capacidades y Salas", () => {
    it("Debería inicializar el estado del cliente y devolver las capacidades del router", async () => {
      const result = await gateway.onGetRouterCapabilities(mockSocket, {
        roomId: "room-test",
      });

      expect(mockWsRoomManager.join).toHaveBeenCalledWith(
        "/webrtc",
        "room-test",
        "socket-123",
        mockSocket,
      );
      expect(result).toEqual({ codecs: [{ mimeType: "video/VP8" }] });
      expect(mockSocket.data.sfu).toBeDefined();
      expect(mockSocket.data.sfu!.roomId).toBe("room-test");
    });

    it("Debería sacar al usuario de una sala previa si intenta unirse a una nueva", async () => {
      mockSocket.data.sfu = { roomId: "sala-vieja" } as any;

      await gateway.onGetRouterCapabilities(mockSocket, {
        roomId: "sala-nueva",
      });

      expect(mockWsRoomManager.leave).toHaveBeenCalledWith(
        "/webrtc",
        "sala-vieja",
        "socket-123",
      );
      expect(mockWsRoomManager.join).toHaveBeenCalledWith(
        "/webrtc",
        "sala-nueva",
        "socket-123",
        mockSocket,
      );
    });
  });

  describe("Transportes", () => {
    // Antes de cada test de transportes, nos aseguramos de que el socket tenga una sala mock asignada
    beforeEach(() => {
      mockSocket.data.sfu = {
        roomId: "room-test",
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
        dataProducers: new Map(),
        dataConsumers: new Map(),
      };
    });

    it("Debería crear un transporte y guardarlo en la memoria del socket", async () => {
      const result = await gateway.onCreateTransport(mockSocket, {
        roomId: "room-test",
      });

      expect(mockRouter.createWebRtcTransport).toHaveBeenCalled();
      expect(mockSocket.data.sfu!.transports.has("trans-1")).toBe(true);

      expect(result.iceServers).toEqual([{ urls: "stun:mock" }]);
      expect(result.suggestedEncodings.simulcast).toEqual([{ rid: "r0" }]);
    });

    it("Debería conectar un transporte existente", async () => {
      mockSocket.data.sfu!.transports.set("trans-1", mockTransport as any);

      const result = await gateway.onConnectTransport(mockSocket, {
        transportId: "trans-1",
        dtlsParameters: {} as any,
      });

      expect(mockTransport.connect).toHaveBeenCalled();
      expect(result).toEqual({ connected: true });
    });
  });

  describe("Productores y Consumidores de Medios", () => {
    beforeEach(() => {
      mockSocket.data.sfu = {
        roomId: "room-test",
        transports: new Map([["trans-1", mockTransport]]),
        producers: new Map(),
        consumers: new Map(),
        dataProducers: new Map(),
        dataConsumers: new Map(),
      };
    });

    it("Debería producir medios, emitir score y notificar al resto de la sala", async () => {
      const result = await gateway.onProduce(mockSocket, {
        roomId: "room-test",
        transportId: "trans-1",
        kind: "video",
        rtpParameters: {} as any,
      });

      expect(mockTransport.produce).toHaveBeenCalled();
      expect(mockSocket.data.sfu!.producers.has("prod-1")).toBe(true);
      expect(result).toEqual({ id: "prod-1" });

      expect(mockBroadcaster.emitToRoom).toHaveBeenCalledWith(
        "/webrtc",
        "room-test",
        "newProducer",
        expect.objectContaining({ producerId: "prod-1", kind: "video" }),
        ["socket-123"],
      );

      expect(scoreCallback).toBeDefined();
      scoreCallback([{ score: 8 }]);

      expect(mockEmit).toHaveBeenCalledWith(
        WEBRTC_MEDIA_SCORE_EVENT,
        expect.objectContaining({
          roomId: "room-test",
          producerId: "prod-1",
          socketId: "socket-123",
          score: 8,
        }),
      );
    });

    it("Debería consumir medios correctamente", async () => {
      const result = await gateway.onConsume(mockSocket, {
        roomId: "room-test",
        transportId: "trans-1",
        producerId: "prod-externo",
        rtpCapabilities: {} as any,
      });

      expect(mockTransport.consume).toHaveBeenCalled();
      expect(mockSocket.data.sfu!.consumers.has("cons-1")).toBe(true);
      expect(result.id).toBe("cons-1");
    });
  });

  describe("Productores y Consumidores de Datos (DataChannels)", () => {
    beforeEach(() => {
      mockSocket.data.sfu = {
        roomId: "room-test",
        transports: new Map([["trans-1", mockTransport]]),
        producers: new Map(),
        consumers: new Map(),
        dataProducers: new Map(),
        dataConsumers: new Map(),
      };
    });

    it("Debería producir datos (DataChannel) y notificar a la sala", async () => {
      const result = await gateway.onProduceData(mockSocket, {
        transportId: "trans-1",
      });

      expect(mockTransport.produceData).toHaveBeenCalled();
      expect(mockSocket.data.sfu!.dataProducers.has("dprod-1")).toBe(true);
      expect(result).toEqual({ id: "dprod-1" });

      expect(mockBroadcaster.emitToRoom).toHaveBeenCalledWith(
        "/webrtc",
        "room-test",
        "newDataProducer",
        expect.objectContaining({ dataProducerId: "dprod-1" }),
        ["socket-123"],
      );
    });

    it("Debería consumir datos (DataChannel)", async () => {
      const result = await gateway.onConsumeData(mockSocket, {
        transportId: "trans-1",
        dataProducerId: "dprod-externo",
      });

      expect(mockTransport.consumeData).toHaveBeenCalled();
      expect(mockSocket.data.sfu!.dataConsumers.has("dcons-1")).toBe(true);
      expect(result.id).toBe("dcons-1");
    });
  });

  describe("Desconexión y Limpieza", () => {
    it("Debería cerrar todos los transportes y notificar al desconectarse", async () => {
      mockSocket.data.sfu = {
        roomId: "room-test",
        transports: new Map([["trans-1", mockTransport]]),
        producers: new Map(),
        consumers: new Map(),
        dataProducers: new Map(),
        dataConsumers: new Map(),
      };

      await gateway.handleDisconnect(mockSocket);

      expect(mockBroadcaster.emitToRoom).toHaveBeenCalledWith(
        "/webrtc",
        "room-test",
        "peerClosed",
        { socketId: "socket-123" },
        ["socket-123"],
      );

      expect(mockTransport.close).toHaveBeenCalled();
      expect(mockSocket.data.sfu.transports.size).toBe(0);
    });
  });
});
