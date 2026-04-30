import type { FastifyInstance } from "fastify";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  describe,
  it,
  vi,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";

import { container } from "../../../src/container/DIContainer.js";
import { FastifyKit } from "../../../src/core/FastifyKit.js";
import { Module } from "../../../src/core/module.decorator.js";
import { Controller } from "../../../src/http/decorators/controller.js";
import { Post } from "../../../src/http/decorators/methods.js";
import { Body, UseParams } from "../../../src/http/decorators/parameters.js";
import { QueueManager } from "../../../src/queues/QueueManager.js";
import { QueueRegistry } from "../../../src/queues/QueueRegistry.js";

// Ruta al archivo de prueba que el worker usará para avisar que terminó
const PROOF_FILE = path.join(process.cwd(), ".worker-proof.txt");

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
    return { message: "Usuario registrado con éxito", trackingId };
  }
}

@Module({ controllers: [UserController] })
class QueueIntegrationModule {}

describe("Integración Worker Pool", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Aseguramos que no exista el archivo de prueba antes de empezar
    await fs.rm(PROOF_FILE, { force: true });
  });

  afterAll(async () => {
    if (app) await app.close();
    await fs.rm(PROOF_FILE, { force: true });
  });

  beforeEach(async () => {
    // Silenciamos los warnings de consola para no ensuciar la salida de los tests
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // Limpiamos el registro de procesadores antes de cada test para evitar interferencias entre tests
    QueueRegistry.clear();

    // Simulamos el discovery del framework para registrar el procesador de la cola,
    // Le inyectamos la ruta absoluta del fixture al registro para que el Worker sepa qué importar
    const fixturePath = path.resolve(
      __dirname,
      "./fixtures/WelcomeWorker.processor.ts",
    );
    QueueRegistry.addProcessorFile(pathToFileURL(fixturePath).href);

    app = await FastifyKit.create({
      module: QueueIntegrationModule,
      queue: { strategy: "worker-pool" },
    });
  });

  describe("Despacho de Tareas End-to-End", () => {
    it("Debería despachar una tarea y el worker en hilo paralelo debe procesarla", async () => {
      const payload = { email: "test@fastifykit.com", name: "Ángel" };

      // Hacemos la petición HTTP
      const response = await app.inject({
        method: "POST",
        url: "/api/users/register",
        payload,
      });

      expect(response.statusCode).toBe(200);
      const responseBody = JSON.parse(response.payload);
      expect(responseBody.data.trackingId).toBeDefined();

      // Esperamos un poco para darle tiempo al Worker Thread de hacer su trabajo
      // (ya que no podemos usar awaits directos ni espías porque es Fire-and-Forget)
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verificamos que el worker creó el archivo de prueba, lo que indica que procesó el trabajo asignado
      const proofExists = await fs
        .stat(PROOF_FILE)
        .then(() => true)
        .catch(() => false);
      expect(proofExists).toBe(true);

      const fileContent = await fs.readFile(PROOF_FILE, "utf-8");
      expect(fileContent).toContain(responseBody.data.trackingId);
    });
  });
});
