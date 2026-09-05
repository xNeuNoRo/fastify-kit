import type { Redis } from "ioredis";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it, expect, beforeEach, vi, afterAll } from "vitest";

import { CONFIG_SERVICE_TOKEN } from "../../../src/config/ConfigService.js";
import { DefaultConfigService } from "../../../src/config/DefaultConfigService.js";
import { INTERNAL_CONFIG_SERVICE_TOKEN } from "../../../src/config/InternalConfigService.js";
import { ScopeType, container } from "../../../src/container/DIContainer.js";
import { FastifyKit } from "../../../src/core/FastifyKit.js";
import { Module } from "../../../src/core/module.decorator.js";
import { registerRedisConnection } from "../../../src/distributed/redis.factory.js";
import { REDIS_CONNECTION_TOKEN } from "../../../src/distributed/redis.token.js";
import { RedisEventBus } from "../../../src/events/RedisEventBus.js";
import { QueueManager } from "../../../src/queues/QueueManager.js";
import {
  QUEUE_REGISTRY_TOKEN,
  QueueRegistryService,
} from "../../../src/queues/QueueRegistryService.js";
import { openRedis, waitFor } from "../support/redis.js";

const redisForTests = await openRedis();
await redisForTests?.quit();

if (!redisForTests) {
  console.warn(
    "[FastifyKit Redis Test] Saltando pruebas de integración distribuida (No se detectó un servidor local en 6379)",
  );
}

const redisIt = redisForTests ? it : it.skip;

function waitForWorkerMessage(
  worker: import("node:worker_threads").Worker,
  predicate: (message: unknown) => boolean,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout>;
    const onError = (error: Error) => {
      clearTimeout(timeout);
      worker.off("message", onMessage);
      worker.off("error", onError);
      reject(error);
    };
    const onMessage = (message: unknown) => {
      if (!predicate(message)) return;
      clearTimeout(timeout);
      worker.off("message", onMessage);
      worker.off("error", onError);
      resolve(message);
    };
    timeout = setTimeout(() => {
      worker.off("message", onMessage);
      worker.off("error", onError);
      reject(new Error("Worker message timed out."));
    }, 10_000);
    worker.on("message", onMessage);
    worker.on("error", onError);
  });
}

describe("Integración Sistema Distribuido (Redis)", () => {
  beforeEach(() => {
    // Mockeamos console.warn y console.info para evitar
    // logs de advertencia durante las pruebas de decodificación fallida
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterAll(() => {
    // Restauramos los mocks para no afectar otras pruebas
    vi.restoreAllMocks();
  });

  redisIt(
    "Debería sincronizar eventos entre dos instancias independientes",
    async () => {
      container.clearAll();
      container.registerClass(QUEUE_REGISTRY_TOKEN, QueueRegistryService);
      container.resolve<QueueRegistryService>(QUEUE_REGISTRY_TOKEN).clear();

      // Configuramos el framework para que las instancias sepan a qué Redis conectar
      // Registramos el ConfigService inyectable y configuramos los datos distribuidos
      const configService = new DefaultConfigService();
      configService.set("distributed", {
        redis: { host: "localhost", port: 6379 },
      });
      container.registerInstance(CONFIG_SERVICE_TOKEN, configService);
      container.registerFactory(
        INTERNAL_CONFIG_SERVICE_TOKEN,
        (c) => c.resolve(CONFIG_SERVICE_TOKEN),
        ScopeType.Singleton,
      );

      // Registramos la conexión compartida
      await registerRedisConnection();

      // Instancia 1
      const bus1 = container.resolve(RedisEventBus);
      // Instancia 2 (Forzamos resolución manual para simular otra app)
      const bus2 = new RedisEventBus();

      const receivedPayloads: any[] = [];
      bus2.on("sync.test", (payload) => {
        receivedPayloads.push(payload);
      });

      // No publicar trabajo hasta que ambos subscribers estén listos.
      await Promise.all([bus1.waitUntilReady(), bus2.waitUntilReady()]);

      try {
        bus1.emit("sync.test", { from: "bus1" }, { target: "global" });
        await waitFor(() => receivedPayloads.length === 1);

        expect(receivedPayloads[0]).toEqual({ from: "bus1" });
      } finally {
        await Promise.allSettled([
          bus1.beforeApplicationShutdown(),
          bus2.beforeApplicationShutdown(),
        ]);
        if (container.has(REDIS_CONNECTION_TOKEN)) {
          const connection = container.resolve<Redis>(REDIS_CONNECTION_TOKEN);
          connection.disconnect();
          container.unregister(REDIS_CONNECTION_TOKEN);
        }
      }
    },
  );

  redisIt(
    "Debería procesar tareas distribuidas y notificar vía EventBus Global",
    async () => {
      container.clearAll();
      container.registerClass(QUEUE_REGISTRY_TOKEN, QueueRegistryService);
      container.resolve<QueueRegistryService>(QUEUE_REGISTRY_TOKEN).clear();

      const { DistributedProcessor: ProcessorImpl } =
        await import("../queues/fixtures/Distributed.processor.js");

      // Registramos el archivo del procesador para que el WorkerPool pueda cargarlo en el hilo
      const fixturePath = path.resolve(
        process.cwd(),
        "test/integration/queues/fixtures/Distributed.processor.ts",
      );
      container
        .resolve<QueueRegistryService>(QUEUE_REGISTRY_TOKEN)
        .addProcessorFile(pathToFileURL(fixturePath).href);

      @Module({
        providers: [ProcessorImpl],
      })
      class DynamicTestModule {}

      // Inicializamos FastifyKit con modo Redis
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

      // Escuchamos el evento global de finalización (Nomenclatura Jerárquica)
      let finalResult: any = null;

      eventBus.on(`queue.distributed-test-queue.done.*`, (payload) => {
        finalResult = payload;
      });

      try {
        await queueManager.dispatch("distributed-test-queue", { test: "data" });
        await waitFor(() => finalResult !== null, { timeoutMs: 10_000 });

        expect(finalResult).toBeDefined();
        expect(finalResult.status).toBe("success");
        expect(finalResult.result.processed).toBe(true);
      } finally {
        await app.close();
      }
    },
  );

  redisIt(
    "Debería sincronizar eventos entre dos apps FastifyKit reales (Multi-Instance)",
    async () => {
      const { Worker } = await import("node:worker_threads");
      const workerPath = path.resolve(
        process.cwd(),
        "test/integration/distributed/fixtures/SecondaryNode.ts",
      );

      // Iniciamos Instancia Secundaria en un hilo aparte (Aislamiento de Memoria/Container)
      const secondaryNode = new Worker(workerPath);
      let workerExited = false;
      secondaryNode.once("exit", () => {
        workerExited = true;
      });
      let app: Awaited<ReturnType<typeof FastifyKit.create>> | undefined;

      try {
        await waitForWorkerMessage(
          secondaryNode,
          (message) => (message as { type?: string }).type === "ready",
        );

        // Iniciamos Instancia Primaria en este hilo
        container.clearAll();
        container.registerClass(QUEUE_REGISTRY_TOKEN, QueueRegistryService);
        container.resolve<QueueRegistryService>(QUEUE_REGISTRY_TOKEN).clear();

        @Module({})
        class PrimaryModule {}

        app = await FastifyKit.create({
          module: PrimaryModule,
          distributed: {
            redis: { host: "localhost", port: 6379 },
            features: { eventBus: true },
          },
        });

        const eventBus = container.resolve(RedisEventBus);
        await eventBus.waitUntilReady();

        const eventReceived = waitForWorkerMessage(
          secondaryNode,
          (message) => (message as { type?: string }).type === "event_received",
        );

        eventBus.emit(
          "distributed.sync.test",
          { data: "from-primary" },
          { target: "global" },
        );

        const receivedMessage = (await eventReceived) as {
          type: string;
          payload: unknown;
        };
        expect(receivedMessage.type).toBe("event_received");
        expect(receivedMessage.payload).toEqual({ data: "from-primary" });
      } finally {
        await app?.close();
        secondaryNode.postMessage("shutdown");
        await Promise.race([
          new Promise<void>((resolve) =>
            secondaryNode.once("exit", () => resolve()),
          ),
          new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
        ]);
        if (!workerExited) {
          await Promise.race([
            secondaryNode.terminate(),
            new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
          ]);
        }
      }
    },
  );
});
