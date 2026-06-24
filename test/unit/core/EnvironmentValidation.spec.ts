/* eslint-disable no-console */
import { Type } from "@sinclair/typebox";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  CONFIG_SERVICE_TOKEN,
  type ConfigService,
} from "../../../src/config/ConfigService.js";
import { container } from "../../../src/container/DIContainer.js";
import { FastifyKit } from "../../../src/core/FastifyKit.js";
import { Module } from "../../../src/core/module.decorator.js";

describe("Validación de Entorno en el Arranque (Boot-Time Env Validation)", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Guardamos el entorno original para restaurarlo después de cada prueba
    originalEnv = process.env;

    // Mockeamos process.exit para evitar que el test runner muera al fallar la validación
    // Lanzamos un error para detener la ejecución y simular el comportamiento real de salida
    processExitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit llamado");
    });

    // Mockeamos console.error para mantener la terminal limpia de los errores intencionales
    vi.spyOn(console, "error").mockImplementation(() => {});

    // Limpiamos la configuración para evitar datos residuales
    if (container.has(CONFIG_SERVICE_TOKEN)) {
      container.resolve<ConfigService>(CONFIG_SERVICE_TOKEN).clear();
    }
  });

  afterEach(() => {
    // Restauramos el entorno original y los mocks después de cada prueba
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // Módulo dummy solo para poder inicializar FastifyKit
  @Module({})
  class TestModule {}

  it("Debería cargar, coaccionar y registrar correctamente las variables de entorno válidas", async () => {
    // Configuramos un entorno simulado
    process.env = {
      ...originalEnv,
      PORT: "3000", // Node.js SIEMPRE almacena las variables como strings
      ENABLE_CACHE: "true",
    };

    const EnvSchema = Type.Object({
      PORT: Type.Number(),
      ENABLE_CACHE: Type.Boolean(),
    });

    const app = await FastifyKit.create({
      module: TestModule,
      envSchema: EnvSchema,
    });

    const configService = container.resolve<ConfigService>(CONFIG_SERVICE_TOKEN);
    // Validamos que los strings fueron coaccionados automáticamente a sus tipos primitivos nativos
    expect(configService.get("PORT")).toBe(3000);
    expect(configService.get("PORT")).not.toBe("3000"); // Validación estricta

    expect(configService.get("ENABLE_CACHE")).toBe(true);
    expect(configService.get("ENABLE_CACHE")).not.toBe("true");

    await app.close();
  });

  it("Debería abortar el arranque del servidor (process.exit) si falta una variable requerida", async () => {
    // Configuramos el entorno omitiendo JWT_SECRET
    process.env = {
      ...originalEnv,
      PORT: "3000",
    };

    const EnvSchema = Type.Object({
      PORT: Type.Number(),
      JWT_SECRET: Type.String(), // Requerida pero ausente en process.env
    });

    // Esperamos que FastifyKit lance el error que definimos en el mock de process.exit
    await expect(
      FastifyKit.create({
        module: TestModule,
        envSchema: EnvSchema,
      }),
    ).rejects.toThrow("process.exit llamado");

    // Verificamos que el framework intentó salir con código de error 1 (Failure)
    expect(processExitSpy).toHaveBeenCalledWith(1);

    // Verificamos que imprimió los errores descriptivos en la consola
    expect(console.error).toHaveBeenCalled();
  });

  it("Debería abortar el arranque del servidor si una variable no puede ser coaccionada al tipo esperado", async () => {
    // Configuramos un entorno inválido
    process.env = {
      ...originalEnv,
      PORT: "not-a-valid-number", // Se esperaba un número
    };

    const EnvSchema = Type.Object({
      PORT: Type.Number(),
    });

    await expect(
      FastifyKit.create({
        module: TestModule,
        envSchema: EnvSchema,
      }),
    ).rejects.toThrow("process.exit llamado");

    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalled();
  });
});
