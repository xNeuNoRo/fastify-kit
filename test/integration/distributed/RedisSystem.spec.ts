import { Redis } from "ioredis";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

import { InternalConfig } from "../../../src/config/InternalConfig.js";
import { container } from "../../../src/container/DIContainer.js";
import { FastifyKit } from "../../../src/core/FastifyKit.js";
import { Module } from "../../../src/core/module.decorator.js";
import { registerRedisConnection } from "../../../src/distributed/redis.factory.js";
import { RedisEventBus } from "../../../src/events/RedisEventBus.js";
import { QueueManager } from "../../../src/queues/QueueManager.js";
import { QueueRegistry } from "../../../src/queues/QueueRegistry.js";

// Herramienta de detección de Redis para saber si correr o no las pruebas de integración
const isRedisAvailable = async () => {
  const client = new Redis({
    host: "localhost",
    port: 6379,
    maxRetriesPerRequest: 0,
    connectTimeout: 2000,
    retryStrategy: () => null,
  });
  try {
    const res = await client.ping();
    await client.quit();
    return res === "PONG";
  } catch (e: any) {
    // Evitamos logs de error innecesarios
    const _err = e;
    return false;
  }
};

describe("Integración Sistema Distribuido (Redis)", () => {
  beforeEach(() => {
    // Mockeamos console.warn y console.info para evitar
    // logs de advertencia durante las pruebas de decodificación fallida
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  let hasRedis = false;
  beforeAll(async () => {
    hasRedis = await isRedisAvailable();
  });

  it("Debería sincronizar eventos entre dos instancias independientes", async () => {
    if (!hasRedis) {
      return;
    }

    container.clearAll();
    QueueRegistry.clear();

    // Configuramos el framework para que las instancias sepan a qué Redis conectar
    InternalConfig.set("distributed", {
      redis: { host: "localhost", port: 6379 },
    });

    // Registramos la conexión compartida
    registerRedisConnection();

    // Instancia 1
    const bus1 = container.resolve(RedisEventBus);
    // Instancia 2 (Forzamos resolución manual para simular otra app)
    const bus2 = new RedisEventBus();

    const receivedPayloads: any[] = [];
    bus2.on("sync.test", (payload) => {
      receivedPayloads.push(payload);
    });

    // Esperar a que las suscripciones de Redis estén listas
    await new Promise((resolve) => setTimeout(resolve, 200));

    bus1.emit("sync.test", { from: "bus1" }, { target: "global" });

    // Esperar el viaje por la red local
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(receivedPayloads).toHaveLength(1);
    expect(receivedPayloads[0]).toEqual({ from: "bus1" });

    await Promise.all([
      bus1.beforeApplicationShutdown(),
      bus2.beforeApplicationShutdown(),
    ]);
  });

  it("Debería procesar tareas distribuidas y notificar vía EventBus Global", async () => {
    if (!hasRedis) {
      return;
    }

    container.clearAll();
    QueueRegistry.clear();

    const { DistributedProcessor: ProcessorImpl } =
      await import("../queues/fixtures/Distributed.processor.js");

    // 1. Registramos el archivo del procesador para que el WorkerPool pueda cargarlo en el hilo
    const fixturePath = path.resolve(
      process.cwd(),
      "test/integration/queues/fixtures/Distributed.processor.ts",
    );
    QueueRegistry.addProcessorFile(pathToFileURL(fixturePath).href);

    @Module({
      providers: [ProcessorImpl],
    })
    class DynamicTestModule {}

    // 2. Inicializamos FastifyKit con modo Redis
    const app = await FastifyKit.create({
      module: DynamicTestModule,
      distributed: {
        redis: { host: "localhost", port: 6379 },
        features: { eventBus: true },
      },
      queue: { strategy: "redis" },
    });

    const queueManager = container.resolve(QueueManager);
    const eventBus = container.resolve(RedisEventBus);

    // 2. Escuchamos el evento global de finalización (Nomenclatura Jerárquica)
    let finalResult: any = null;

    eventBus.on(`queue.distributed-test-queue.done.*`, (payload) => {
      finalResult = payload;
    });

    // 4. Despachamos el trabajo
    await queueManager.dispatch("distributed-test-queue", { test: "data" });

    // 5. Esperamos a que el WorkerPool y el EventBus hagan su magia
    let attempts = 0;
    while (!finalResult && attempts < 40) {
      await new Promise((r) => setTimeout(r, 100));
      attempts++;
    }

    expect(finalResult).toBeDefined();
    expect(finalResult.status).toBe("success");
    expect(finalResult.result.processed).toBe(true);

    await app.close();
  });
});
