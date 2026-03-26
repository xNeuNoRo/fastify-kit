import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "vitest";

import { container } from "../../../../src/container/DIContainer.js";
import {
  discoverControllers,
  discoverModules,
} from "../../../../src/http/routing/discovery.js";
import { LOGGER_TOKEN } from "../../../../src/logger/LoggerContract.js";

describe("Motor de Auto-Descubrimiento (Discovery)", () => {
  let tmpDir: string;
  let loggerMock: any;

  beforeAll(async () => {
    // Creamos un directorio temporal para simular la estructura de archivos de controladores y módulos
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fastify-kit-discovery-"));

    // Creamos varios archivos con diferentes casos para probar el discovery

    // Controlador Válido
    await fs.writeFile(
      path.join(tmpDir, "users.controller.js"),
      `const meta = Symbol.for("Symbol.metadata");
       export class UsersController {}
       UsersController[meta] = { prefix: "/users" };
       export class IgnoredClass {} // Sin metadata, debe ignorarse`,
    );

    // Módulo Válido
    await fs.writeFile(
      path.join(tmpDir, "app.module.js"),
      `const meta = Symbol.for("Symbol.metadata");
       export class AppModule {}
       AppModule[meta] = { moduleOptions: {} };`,
    );

    // Controlador Inválido (sin metadata)
    await fs.writeFile(
      path.join(tmpDir, "empty.controller.js"),
      `export class EmptyController {}`,
    );

    // Directorio Anidado
    const nestedDir = path.join(tmpDir, "nested");
    await fs.mkdir(nestedDir);
    await fs.writeFile(
      path.join(nestedDir, "auth.controller.js"),
      `const meta = Symbol.for("Symbol.metadata");
       export class AuthController {}
       AuthController[meta] = { prefix: "/auth" };`,
    );

    // Archivo Roto (Causa el error simulado)
    await fs.writeFile(
      path.join(tmpDir, "broken.controller.js"),
      `throw new Error("Error simulado de sintaxis o importación");`,
    );

    // Archivo con sufijo personalizado para probar la opción de configuración
    await fs.writeFile(
      path.join(tmpDir, "custom.handler.js"),
      `const meta = Symbol.for("Symbol.metadata");
       export class CustomHandler {}
       CustomHandler[meta] = { prefix: "/custom" };`,
    );
  });

  // Limpiamos la basura del disco duro al terminar todos los tests
  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // Antes de cada test, preparamos el mock del logger y espiamos console.warn para evitar ruido en los tests
  beforeEach(() => {
    loggerMock = {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    // Registramos el mock del logger en el contenedor de dependencias para que el discovery lo use
    container.registerInstance(LOGGER_TOKEN, loggerMock);

    // El discovery usa console.warn para los errores de fs.readdir
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  // Después de cada test, restauramos los mocks para evitar interferencias entre tests
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Autodescubrimiento de controladores (discoverControllers)", () => {
    it("Debería encontrar y cargar recursivamente solo las clases con metadata.prefix", async () => {
      const controllers = await discoverControllers({ baseDir: tmpDir });

      // Debe encontrar 2: UsersController (raíz) y AuthController (anidado)
      expect(controllers).toHaveLength(2);

      const names = controllers.map((c) => c.name);
      expect(names).toContain("UsersController");
      expect(names).toContain("AuthController");

      // Debe ignorar la clase vacía y el módulo
      expect(names).not.toContain("IgnoredClass");
      expect(names).not.toContain("EmptyController");
      expect(names).not.toContain("AppModule");
    });

    it("Debería permitir la búsqueda con un sufijo personalizado (string o array)", async () => {
      const controllers = await discoverControllers({
        baseDir: tmpDir,
        suffix: [".handler.js"], // Probamos la opción de array
      });

      expect(controllers).toBeDefined();
      expect(controllers).toHaveLength(1);
      expect(controllers[0].name).toBe("CustomHandler");
    });
  });

  describe("Autodescubrimiento de módulos (discoverModules)", () => {
    it("Debería encontrar y cargar solo las clases con metadata.moduleOptions", async () => {
      const modules = await discoverModules({ baseDir: tmpDir });

      // Solo debe encontrar AppModule
      expect(modules).toBeDefined();
      expect(modules).toHaveLength(1);
      expect(modules[0].name).toBe("AppModule");
    });
  });

  describe("Manejo de Errores", () => {
    it("Debería atrapar errores de importación (archivo roto) y loguear un warning sin detener el escaneo", async () => {
      const errorDir = path.join(tmpDir, "isolated-error");
      await fs.mkdir(errorDir);
      await fs.writeFile(
        path.join(errorDir, "broken.controller.js"),
        `throw new Error("Error simulado de sintaxis o importación");`,
      );
      await discoverControllers({ baseDir: errorDir });

      // Verificamos que el logger.warn fue llamado por culpa de 'broken.controller.js'
      expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    });

    it("Debería manejar errores de lectura de directorios (ej. carpeta inexistente) sin colapsar", async () => {
      const fakeDir = path.join(tmpDir, "does-not-exist");
      const controllers = await discoverControllers({ baseDir: fakeDir });

      // Como la carpeta no existe, devuelve array vacío
      expect(controllers).toHaveLength(0);

      // Y debe haber logueado el error nativo con console.warn
      // eslint-disable-next-line no-console
      expect(console.warn).toHaveBeenCalledTimes(1);
    });
  });
});
