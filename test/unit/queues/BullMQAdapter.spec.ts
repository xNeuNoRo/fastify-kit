import * as bullmq from "bullmq";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { container } from "../../../src/container/DIContainer.js";
import { REDIS_CONNECTION_TOKEN } from "../../../src/distributed/redis.factory.js";
import { EVENT_BUS_TOKEN } from "../../../src/events/EventBus.js";
import { BullMQAdapter } from "../../../src/queues/adapters/BullMQAdapter.js";

describe("BullMQAdapter - Adaptador de Colas para BullMQ (Unit Test)", () => {
  let adapter: BullMQAdapter;
  let mockRedis: any;
  let mockQueueInstance: any;

  beforeEach(() => {
    container.clearAll();
    vi.clearAllMocks();

    mockRedis = {
      quit: vi.fn().mockResolvedValue("OK"),
      on: vi.fn(),
    };

    mockQueueInstance = {
      add: vi.fn().mockResolvedValue({ id: "job-123" }),
      close: vi.fn().mockResolvedValue(undefined),
    };

    // Usamos vi.spyOn en el constructor de Queue para no mockear el módulo globalmente.
    vi.spyOn(bullmq, "Queue").mockImplementation(() => mockQueueInstance);

    // Mock del EventBus para el instanceId requerido por el ruteo dirigido
    const mockEventBus = { instanceId: "test-instance" };
    container.registerInstance(EVENT_BUS_TOKEN, mockEventBus);

    container.registerInstance(REDIS_CONNECTION_TOKEN, mockRedis);
    adapter = new BullMQAdapter();
  });

  it("Debería registrar e instanciar colas usando la conexión compartida de Redis", async () => {
    await adapter.dispatch("test-queue", { data: 1 });
    await adapter.dispatch("test-queue", { data: 1 });

    expect(bullmq.Queue).toHaveBeenCalledWith(
      "test-queue",
      expect.objectContaining({
        connection: mockRedis,
      }),
    );

    expect(bullmq.Queue).toHaveBeenCalledTimes(1);
  });

  it("Debería cerrar todas las colas registradas pero NO la conexión central de Redis en su propio shutdown", async () => {
    await adapter.dispatch("q1", {});
    await adapter.dispatch("q2", {});

    await adapter.beforeApplicationShutdown();

    expect(mockQueueInstance.close).toHaveBeenCalledTimes(2);
    expect(mockRedis.quit).not.toHaveBeenCalled();
  });
});
