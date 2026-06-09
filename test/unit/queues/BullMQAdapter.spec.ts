import { Queue } from "bullmq";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { container } from "../../../src/container/DIContainer.js";
import { REDIS_CONNECTION_TOKEN } from "../../../src/distributed/redis.factory.js";
import { BullMQAdapter } from "../../../src/queues/adapters/BullMQAdapter.js";

// Mock de BullMQ
vi.mock("bullmq", () => {
  return {
    Queue: vi.fn().mockImplementation((name, opts) => ({
      name,
      opts,
      add: vi.fn().mockResolvedValue({ id: "job-123" }),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

describe("BullMQAdapter - Adaptador de Colas para BullMQ (Unit Test)", () => {
  let adapter: BullMQAdapter;
  let mockRedis: any;

  beforeEach(() => {
    container.clearAll();
    vi.clearAllMocks();
    mockRedis = {
      quit: vi.fn().mockResolvedValue("OK"),
      on: vi.fn(),
    };

    container.registerInstance(REDIS_CONNECTION_TOKEN, mockRedis);
    adapter = new BullMQAdapter();
  });

  it("Debería registrar e instanciar colas usando la conexión compartida de Redis", async () => {
    await adapter.dispatch("test-queue", { data: 1 });
    await adapter.dispatch("test-queue", { data: 1 });

    expect(Queue).toHaveBeenCalledWith(
      "test-queue",
      expect.objectContaining({
        connection: mockRedis,
      }),
    );

    expect(Queue).toHaveBeenCalledTimes(1);
  });

  it("Debería cerrar todas las colas registradas pero NO la conexión central de Redis en su propio shutdown", async () => {
    await adapter.dispatch("q1", {});
    await adapter.dispatch("q2", {});

    await adapter.beforeApplicationShutdown();

    const queueInstances = (Queue as any).mock.results.map((r: any) => r.value);

    for (const q of queueInstances) {
      expect(q.close).toHaveBeenCalled();
    }

    expect(mockRedis.quit).not.toHaveBeenCalled();
  });
});
