import type { FastifyInstance } from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, afterEach, beforeEach } from "vitest";

import { CreateUserCommand } from "./fixtures/CreateUser.command.js";
import { CreateUserHandler } from "./fixtures/CreateUser.handler.js";
import { TestCqrsController } from "./fixtures/Test.controller.js";
import { container } from "../../../src/container/DIContainer.js";
import { FastifyKit } from "../../../src/core/FastifyKit.js";
import { Module } from "../../../src/core/module.decorator.js";
import { getCqrsHandlerToken } from "../../../src/cqrs/utils/cqrs-token.util.js";

// Obtenemos el __dirname equivalente en ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Creamos un módulo falso que apunte a nuestra carpeta de fixtures
@Module({
  controllers: [TestCqrsController],
  autoDiscoverCQRSHandlers: {
    baseDir: path.join(__dirname, "fixtures"),
  },
})
class TestAppModule {}

describe("CQRS Integration (E2E)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const token = getCqrsHandlerToken(CreateUserCommand);
    container.registerClass(token, CreateUserHandler);

    app = await FastifyKit.create({
      module: TestAppModule,
      fastifyOptions: { logger: false },
    });

    await app.ready();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    container.clearAll();
  });

  it("Debería escanear, registrar y ejecutar el flujo CQRS completo vía HTTP", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/test-cqrs",
      payload: {
        name: "Ángel González",
      },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.data).toEqual({
      result: "User Ángel González created successfully",
    });
  });
});
