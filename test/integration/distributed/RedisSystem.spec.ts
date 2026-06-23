import { Redis } from "ioredis";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it, expect, beforeEach, vi, afterAll } from "vitest";

import {
  CONFIG_SERVICE_TOKEN,
  type ConfigService,
} from "../../../src/config/ConfigService.js";
import { DefaultConfigService } from "../../../src/config/DefaultConfigService.js";
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
    host: "127.0.0.1",
    port: 6379,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    retryStrategy: () => null,
  });

  client.on("error", () => {
    // Evita logs ruidosos de ioredis durante el healthcheck
  });

  try {
    await client.connect();
    const res = await client.ping();
    await client.quit();
    return res === "PONG";
  } catch (e: any) {
    // Evitamos logs de error innecesarios
    const _err = e;
    return false;
  }
};

const hasRedis = await isRedisAvailable();

if (!hasRedis) {
  console.warn(
    "[FastifyKit Redis Test] Saltando pruebas de integración distribuida (No se detectó un servidor local en 6379)",
  );
}

const redisIt = hasRedis ? it : it.skip;

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
      QueueRegistry.clear();

      // Configuramos el framework para que las instancias sepan a qué Redis conectar
      // Registramos el ConfigService inyectable y configuramos los datos distribuidos
      const configService = new DefaultConfigService();
      configService.set("distributed", {
        redis: { host: "localhost", port: 6379 },
      });
      container.registerInstance(CONFIG_SERVICE_TOKEN, configService);

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
    },
  );

  redisIt(
    "Debería procesar tareas distribuidas y notificar vía EventBus Global",
    async () => {
      container.clearAll();
      QueueRegistry.clear();

      const { DistributedProcessor: ProcessorImpl } =
        await import("../queues/fixtures/Distributed.processor.js");

      // Registramos el archivo del procesador para que el WorkerPool pueda cargarlo en el hilo
      const fixturePath = path.resolve(
        process.cwd(),
        "test/integration/queues/fixtures/Distributed.processor.ts",
      );
      QueueRegistry.addProcessorFile(pathToFileURL(fixturePath).href);

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

      // Despachamos el trabajo
      await queueManager.dispatch("distributed-test-queue", { test: "data" });

      // Esperamos a que el WorkerPool y el EventBus hagan su magia
      let attempts = 0;
      while (!finalResult && attempts < 40) {
        await new Promise((r) => setTimeout(r, 100));
        attempts++;
      }

      expect(finalResult).toBeDefined();
      expect(finalResult.status).toBe("success");
      expect(finalResult.result.processed).toBe(true);

      await app.close();
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

      // Esperamos a que el nodo secundario esté listo
      await new Promise((resolve) => {
        secondaryNode.on("message", (msg) => {
          if (msg.type === "ready") resolve(true);
        });
      });

      // Iniciamos Instancia Primaria en este hilo
      container.clearAll();
      QueueRegistry.clear();

      @Module({})
      class PrimaryModule {}

      const app = await FastifyKit.create({
        module: PrimaryModule,
        distributed: {
          redis: { host: "localhost", port: 6379 },
          features: { eventBus: true },
        },
      });

      const eventBus = container.resolve(RedisEventBus);

      // Emitimos evento desde Primaria hacia Global
      let eventReceivedBySecondary = false;
      let receivedPayload: any = null;

      secondaryNode.on("message", (msg) => {
        if (msg.type === "event_received") {
          eventReceivedBySecondary = true;
          receivedPayload = msg.payload;
        }
      });

      // Esperar un poco para que el bus de la instancia primaria se conecte
      await new Promise((r) => setTimeout(r, 300));

      eventBus.emit(
        "distributed.sync.test",
        { data: "from-primary" },
        { target: "global" },
      );

      // Verificamos recepción en la otra instancia
      let attempts = 0;
      while (!eventReceivedBySecondary && attempts < 30) {
        await new Promise((r) => setTimeout(r, 100));
        attempts++;
      }

      expect(eventReceivedBySecondary).toBe(true);
      expect(receivedPayload).toEqual({ data: "from-primary" });

      // Cleanup
      secondaryNode.postMessage("shutdown");
      await app.close();
    },
  );
});
