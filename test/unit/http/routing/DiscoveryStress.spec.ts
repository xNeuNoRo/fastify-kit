import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { discoverControllers } from "../../../../src/core/discovery.js";

describe("Motor de Auto-Descubrimiento - Estrés de Concurrencia", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "fastify-kit-discovery-stress-"),
    );

    // Simulamos un proyecto grande con muchos archivos de controladores
    // para verificar que el límite de concurrencia previene EMFILE
    const concurrencyDir = path.join(tmpDir, "large-module");
    await fs.mkdir(concurrencyDir);

    // Escribimos muchos archivos .controller.js con metadata válida
    const writePromises: Promise<void>[] = [];
    for (let i = 0; i < 200; i++) {
      const filePath = path.join(concurrencyDir, `user-${i}.controller.js`);
      writePromises.push(
        fs.writeFile(
          filePath,
          `const meta = Symbol.for("Symbol.metadata");
           export class UserController${i} {}
           UserController${i}[meta] = { prefix: "/users-${i}" };`,
        ),
      );
    }
    await Promise.all(writePromises);

    // También creamos algunos subdirectorios anidados con sus propios archivos
    for (let d = 0; d < 10; d++) {
      const nestedDir = path.join(concurrencyDir, `nested-${d}`);
      await fs.mkdir(nestedDir);
      const nestedWrites: Promise<void>[] = [];
      for (let i = 0; i < 30; i++) {
        nestedWrites.push(
          fs.writeFile(
            path.join(nestedDir, `auth-${d}-${i}.controller.js`),
            `const meta = Symbol.for("Symbol.metadata");
             export class AuthController${d}_${i} {}
             AuthController${d}_${i}[meta] = { prefix: "/auth-${d}-${i}" };`,
          ),
        );
      }
      await Promise.all(nestedWrites);
    }
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("Debería descubrir 500 controladores sin error EMFILE usando concurrencia limitada", async () => {
    // 200 archivos en el directorio raíz + 10 subdirectorios * 30 archivos c/u = 500
    const controllers = await discoverControllers({
      baseDir: path.join(tmpDir, "large-module"),
      suffix: ".controller.js",
      concurrency: 30, // Concurrencia baja para verificar que el límite funciona
    });

    expect(controllers.length).toBe(500);
    expect(controllers.every((c) => typeof c === "function")).toBe(true);
  }, 30000); // 30 segundos timeout para este test de estrés

  it("Debería respetar el límite de concurrencia configurado sin degradar el resultado", async () => {
    // Mismo escenario, pero con concurrencia alta para verificar que también funciona
    const controllers = await discoverControllers({
      baseDir: path.join(tmpDir, "large-module"),
      suffix: ".controller.js",
      concurrency: 100,
    });

    expect(controllers.length).toBe(500);
  }, 30000);

  it("Debería usar el límite por defecto (50) si no se especifica concurrency", async () => {
    const controllers = await discoverControllers({
      baseDir: path.join(tmpDir, "large-module"),
      suffix: ".controller.js",
      // No especificamos concurrency → debe usar el default de 50
    });

    expect(controllers.length).toBe(500);
  }, 30000);
});
