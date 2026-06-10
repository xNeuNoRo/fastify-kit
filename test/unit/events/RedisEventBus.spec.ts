import * as ioredis from "ioredis";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { container } from "../../../src/container/DIContainer.js";
import { REDIS_CONNECTION_TOKEN } from "../../../src/distributed/redis.factory.js";
import { RedisEventBus } from "../../../src/events/RedisEventBus.js";

describe("RedisEventBus - Eventos Distribuidos (Unit Test)", () => {
  let bus: RedisEventBus;
  let mockPub: any;
  let mockSub: any;

  beforeEach(() => {
    container.clearAll();

    // Mock del cliente PUB
    mockPub = {
      publish: vi.fn().mockResolvedValue(1),
      on: vi.fn(),
      quit: vi.fn().mockResolvedValue("OK"),
    };
    container.registerInstance(REDIS_CONNECTION_TOKEN, mockPub);

    // Mock del cliente SUB
    mockSub = {
      subscribe: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      quit: vi.fn().mockResolvedValue("OK"),
    };

    // Usamos vi.spyOn para interceptar el constructor de Redis sin mockear el módulo globalmente.
    vi.spyOn(ioredis, "Redis").mockImplementation(() => mockSub);

    bus = new RedisEventBus();
  });

  it("Debería emitir LOCALMENTE por defecto sin tocar Redis", () => {
    const listener = vi.fn();
    bus.on("test", listener);

    bus.emit("test", { msg: "hello" }); // target: local por defecto

    expect(listener).toHaveBeenCalledWith({ msg: "hello" });
    expect(mockPub.publish).not.toHaveBeenCalled();
  });

  it("Debería emitir GLOBALMENTE disparando local y publicando en Redis", async () => {
    await Promise.resolve(); // Simulamos async

    const listener = vi.fn();
    bus.on("global-event", listener);

    bus.emit("global-event", { data: 1 }, { target: "global" });

    // Se dispara localmente de inmediato
    expect(listener).toHaveBeenCalledWith({ data: 1 });

    // Se publica en Redis
    expect(mockPub.publish).toHaveBeenCalledWith(
      "fastify-kit:events:global",
      expect.stringContaining('"eventName":"global-event"'),
    );
  });

  it("Debería soportar el transporte de Buffers binarios usando Reviver/Replacer", () => {
    const buffer = Buffer.from("FastifyKit-Binary-Test");

    bus.emit("binary", { file: buffer }, { target: "global" });

    const publishCall = mockPub.publish.mock.calls[0];
    const sentMessage = JSON.parse(publishCall[1]);

    // Verificamos que el replacer hizo su trabajo
    expect(sentMessage.payload.file).toEqual({
      _fk_type: "Buffer",
      data: buffer.toString("base64"),
    });
  });

  it("Debería ignorar mensajes de Redis que provengan de sí mismo (Eco-Protection)", () => {
    const listener = vi.fn();
    bus.on("eco-test", listener);

    // Simulamos llegada de mensaje desde Redis
    const onMessageCallback = mockSub.on.mock.calls.find(
      (c: any) => c[0] === "message",
    )[1];

    // Mensaje con el mismo instanceId que el bus actual
    const message = JSON.stringify({
      eventName: "eco-test",
      payload: {},
      _sourceId: bus.instanceId,
    });

    onMessageCallback("fastify-kit:events:global", message);

    expect(listener).not.toHaveBeenCalled();
  });
});
