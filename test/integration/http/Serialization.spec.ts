import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { FastifyKit } from "../../../src/core/FastifyKit.js";
import { Module } from "../../../src/core/module.decorator.js";
import { Controller } from "../../../src/http/decorators/controller.js";
import { Get } from "../../../src/http/decorators/methods.js";
import { Serialize } from "../../../src/http/decorators/serialize.js";

// Aseguramos que Symbol.metadata esté definido
if (!(Symbol as any).metadata) {
  (Symbol as any).metadata = Symbol.for("Symbol.metadata");
}

describe("Serialización de Respuestas (Integración)", () => {
  let app: FastifyInstance;

  // Definimos un DTO público (lo que el cliente SÍ puede ver)
  const PublicUserSchema = Type.Object({
    id: Type.Number(),
    username: Type.String(),
  });

  // Controlador dummy de prueba
  @Controller("/users")
  class UserController {
    // Creamos una Ruta SIN la serializacion de salida (no deberia proteger nada y se expondra tal cual)
    @Get("/unsafe")
    getUnsafeUser() {
      return {
        id: 1,
        username: "angel",
        passwordHash: "super-secret-hash-123",
        stripeCustomerId: "cus_99999",
      };
    }

    // Creamos una Ruta CON la serializacion de salida (Deberia filtrar y estructurar la respuesta segun el esquema definido)
    @Get("/safe")
    @Serialize(PublicUserSchema) // 🛡️ Activamos el escudo
    getSafeUser() {
      return {
        id: 1,
        username: "angel",
        passwordHash: "super-secret-hash-123",
        stripeCustomerId: "cus_99999",
      };
    }
  }

  // Creamos el modulo de prueba que incluye el controlador
  @Module({ controllers: [UserController] })
  class TestModule {}

  beforeAll(async () => {
    // Inicializamos el framework
    app = await FastifyKit.create({
      module: TestModule,
    });
    // No necesitamos app.listen() porque usaremos app.inject()
  });

  afterAll(async () => {
    await app.close();
  });

  it("Debería enviar TODOS los datos si la ruta NO tiene @Serialize", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/users/unsafe",
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.payload);

    // Como no hay @Serialize, Fastify devuelve lo que el controlador retorna
    expect(body.data).toHaveProperty("passwordHash");
    expect(body.data).toHaveProperty("stripeCustomerId");
  });

  it("Debería filtrar los datos sensibles y estructurar la respuesta si la ruta SÍ tiene @Serialize", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/users/safe",
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.payload);

    // Verificamos que el Scanner lo envolvió correctamente en el ApiResponse
    expect(body.ok).toBe(true);
    expect(body.error).toBeNull();
    expect(body.timestamp).toBeDefined();

    // Verificamos que los datos públicos están presentes
    expect(body.data).toEqual({
      id: 1,
      username: "angel",
    });

    // LA PRUEBA DE FUEGO: Los datos sensibles NO deben existir
    expect(body.data).not.toHaveProperty("passwordHash");
    expect(body.data).not.toHaveProperty("stripeCustomerId");
  });
});
