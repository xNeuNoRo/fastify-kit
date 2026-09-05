import { describe, expect, it, vi } from "vitest";

import { encodeInvalidationMessage } from "../../../../src/cache/redis/CacheInvalidationCodec.js";
import { CacheInvalidationSubscriber } from "../../../../src/cache/redis/CacheInvalidationSubscriber.js";

function makeConnection() {
  const handlers = new Map<string, (...args: any[]) => void>();
  const subscriber = {
    subscribe: vi.fn(() => Promise.resolve(1)),
    unsubscribe: vi.fn(() => Promise.resolve(1)),
    quit: vi.fn(() => Promise.resolve("OK")),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers.set(event, handler);
      return subscriber;
    }),
  };
  const connection = {
    duplicate: vi.fn(() => subscriber),
  };
  return {
    connection,
    subscriber,
    emit: (event: string, ...args: any[]) => handlers.get(event)?.(...args),
  };
}

describe("CacheInvalidationSubscriber", () => {
  it("procesa invalidaciones secuencialmente y fusiona claves pendientes", async () => {
    const fake = makeConnection();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let concurrent = 0;
    let maxConcurrent = 0;
    const handled: string[] = [];
    const subscriber = new CacheInvalidationSubscriber("cache", "self");

    await subscriber.start(fake.connection as never, async (message) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await gate;
      handled.push(message.namespace);
      concurrent--;
    });

    fake.emit(
      "message",
      "cache",
      encodeInvalidationMessage({
        namespace: "users",
        namespaceVersion: 1,
        keys: ["users:1"],
      }),
    );
    fake.emit(
      "message",
      "cache",
      encodeInvalidationMessage({
        namespace: "users",
        namespaceVersion: 2,
        keys: ["users:2"],
      }),
    );

    await Promise.resolve();
    expect(maxConcurrent).toBe(1);
    release();
    await new Promise((resolve) => setImmediate(resolve));

    expect(handled).toEqual(["users"]);
    expect(maxConcurrent).toBe(1);
    await subscriber.stop();
  });

  it("conserva la union de claves cuando una invalidacion posterior es un superconjunto", async () => {
    const fake = makeConnection();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handled: string[][] = [];
    const subscriber = new CacheInvalidationSubscriber("cache", "self");

    await subscriber.start(fake.connection as never, async (message) => {
      if (message.namespace === "orders") {
        await gate;
        return;
      }
      handled.push(message.keys ?? []);
    });

    fake.emit(
      "message",
      "cache",
      encodeInvalidationMessage({
        namespace: "orders",
        namespaceVersion: 1,
      }),
    );
    fake.emit(
      "message",
      "cache",
      encodeInvalidationMessage({
        namespace: "users",
        namespaceVersion: 1,
        keys: ["users:1"],
      }),
    );
    fake.emit(
      "message",
      "cache",
      encodeInvalidationMessage({
        namespace: "users",
        namespaceVersion: 2,
        keys: ["users:1", "users:2"],
      }),
    );

    release();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(handled).toEqual([["users:1", "users:2"]]);
    await subscriber.stop();
  });

  it("falla start cuando la suscripción falla y permite reintentar", async () => {
    const fake = makeConnection();
    fake.subscriber.subscribe
      .mockRejectedValueOnce(new Error("redis unavailable"))
      .mockResolvedValueOnce(1);
    const subscriber = new CacheInvalidationSubscriber("cache", "self");

    await expect(
      subscriber.start(fake.connection as never, vi.fn()),
    ).rejects.toThrow("redis unavailable");
    expect(subscriber.isActive()).toBe(false);
    await expect(
      subscriber.start(fake.connection as never, vi.fn()),
    ).resolves.toBeUndefined();
    expect(subscriber.isActive()).toBe(true);
    await subscriber.stop();
  });

  it("no bloquea stop si Redis no responde al quit", async () => {
    const fake = makeConnection();
    fake.subscriber.quit.mockImplementation(() => new Promise<never>(() => {}));
    const subscriber = new CacheInvalidationSubscriber("cache", "self");

    await subscriber.start(fake.connection as never, vi.fn());
    await subscriber.stop();

    expect(fake.subscriber.disconnect).toHaveBeenCalledOnce();
    expect(subscriber.isActive()).toBe(false);
  });
});
