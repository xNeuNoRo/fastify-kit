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

/**
 * Hace polling del sistema de archivos esperando que el worker cree el archivo y escriba el contenido.
 * Revisa cada 50ms. Se rinde si pasa el maxWaitMs (por defecto 15 segundos).
 */
async function waitForWorkerProof(
  filePath: string,
  expectedContent: string,
  maxWaitMs = 15000,
): Promise<boolean> {
  const start = Date.now();

  while (Date.now() - start < maxWaitMs) {
    try {
      const content = await fs.readFile(filePath, "utf-8");

      // Si el contenido del archivo incluye el contenido esperado,
      // consideramos que el worker procesó la tarea correctamente
      if (content.includes(expectedContent)) {
        return true;
      }
    } catch (e) {
      // El archivo aún no existe, ignoramos el error y seguimos esperando
    }

    // Esperamos 50ms reales antes del siguiente chequeo
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return false; // Se acabó el tiempo
}

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

      // Esperamos a que el worker cree el archivo de prueba con el trackingId dentro para confirmar que procesó la tarea
      const success = await waitForWorkerProof(
        PROOF_FILE,
        responseBody.data.trackingId,
      );
      expect(success).toBe(true);
    });
  });
});
