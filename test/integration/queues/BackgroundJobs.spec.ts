import type { FastifyInstance } from "fastify";
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
  beforeEach,
  afterEach,
} from "vitest";

import { container } from "../../../src/container/DIContainer.js";
import { FastifyKit } from "../../../src/core/FastifyKit.js";
import { Module } from "../../../src/core/module.decorator.js";
import { Controller } from "../../../src/http/decorators/controller.js";
import { Post } from "../../../src/http/decorators/methods.js";
import { Body, UseParams } from "../../../src/http/decorators/parameters.js";
import { Processor } from "../../../src/queues/decorators/processor.js";
import { QueueManager } from "../../../src/queues/QueueManager.js";
import {
  QUEUE_REGISTRY_TOKEN,
  type QueueRegistryService,
} from "../../../src/queues/QueueRegistryService.js";

// Aseguramos que la metadata exista por si acaso
if (!(Symbol as any).metadata) {
  (Symbol as any).metadata = Symbol.for("Symbol.metadata");
}

const mockProcessorSpy = vi.fn().mockResolvedValue("tarea-completada");

@Processor("email-welcome-queue", "io")
class WelcomeEmailProcessor {
  async handle(jobId: string, payload: any) {
    await Promise.resolve(); // Simulamos una op. async
    return mockProcessorSpy(jobId, payload);
  }
}

@Controller("api/users")
class UserController {
  private get queueManager(): QueueManager {
    return container.resolve(QueueManager);
  }

  @Post("/register")
  @UseParams(Body())
  async registerUser(body: { email: string; name: string }) {
    const trackingId = await this.queueManager.dispatch(
      "email-welcome-queue",
      body,
    );

    return {
      message: "Usuario registrado con éxito",
      trackingId,
    };
  }
}

@Module({
  controllers: [UserController],
  providers: [WelcomeEmailProcessor],
})
class QueueIntegrationModule {}

describe("Integración Background Jobs", () => {
  let app: FastifyInstance;

  beforeAll(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterAll(async () => {
    if (app) await app.close();
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    // Desactivamos logs para no ensuciar la salida de los tests
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    app = await FastifyKit.create({
      module: QueueIntegrationModule,
      queue: { strategy: "in-process" },
    });
    mockProcessorSpy.mockClear();
  });

  afterEach(() => {
    const queueRegistry =
      container.resolve<QueueRegistryService>(QUEUE_REGISTRY_TOKEN);
    queueRegistry.clear();
  });

  describe("Discovery de los Procesadores", () => {
    it("Debería escanear y registrar correctamente el Procesador en el contenedor", () => {
      const queueRegistry =
        container.resolve<QueueRegistryService>(QUEUE_REGISTRY_TOKEN);
      const processorClass = queueRegistry.getProcessor("email-welcome-queue");
      expect(processorClass).toBe(WelcomeEmailProcessor);
    });
  });

  describe("Despacho de Tareas End-to-End", () => {
    it("Debería despachar una tarea desde el controlador sin bloquear la respuesta HTTP", async () => {
      const payload = { email: "test@fastifykit.com", name: "Ángel" };

      const response = await app.inject({
        method: "POST",
        url: "/api/users/register",
        payload,
      });

      expect(response.statusCode).toBe(200);

      const responseBody = JSON.parse(response.payload);
      expect(responseBody.data.trackingId).toBeDefined();

      await new Promise((resolve) => setImmediate(resolve));

      expect(mockProcessorSpy).toHaveBeenCalledTimes(1);
      expect(mockProcessorSpy).toHaveBeenCalledWith(
        responseBody.data.trackingId,
        payload,
      );
    });
  });
});
