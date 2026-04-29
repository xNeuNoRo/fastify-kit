import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { FastifyKit } from "../../../src/core/FastifyKit.js";
import { Module } from "../../../src/core/module.decorator.js";
import { Controller } from "../../../src/http/decorators/controller.js";
import { Get } from "../../../src/http/decorators/methods.js";
import { StaticAssets } from "../../../src/http/decorators/static.js";
import { StaticFile } from "../../../src/http/responses/StaticFile.js";

// Rutas temporales para pruebas de archivos estáticos
const TEMP_DIR = path.join(process.cwd(), "temp-static-test");
const GLOBAL_DIR = path.join(TEMP_DIR, "global");
const SCOPED_DIR = path.join(TEMP_DIR, "scoped");

// Funcion para crear archivos de prueba antes de la suite y limpiar después
function setupTestFiles() {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);
  if (!fs.existsSync(GLOBAL_DIR)) fs.mkdirSync(GLOBAL_DIR);
  if (!fs.existsSync(SCOPED_DIR)) fs.mkdirSync(SCOPED_DIR);

  fs.writeFileSync(path.join(GLOBAL_DIR, "style.css"), "body { color: red; }");
  fs.writeFileSync(path.join(GLOBAL_DIR, "index.html"), "<h1>Home</h1>");

  fs.writeFileSync(path.join(SCOPED_DIR, "secret.txt"), "Top Secret Data");
  fs.writeFileSync(path.join(SCOPED_DIR, "report.pdf"), "Fake PDF Content");
}

// Funcion para limpiar los archivos de prueba después de la suite
function cleanupTestFiles() {
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}

// --------------------------------------------------------
// Controladores y módulos de prueba
// --------------------------------------------------------

// Controlador con StaticAssets a nivel de clase (Scoped)
@Controller("private-docs")
@StaticAssets({ root: SCOPED_DIR, compress: true })
class ScopedStaticController {
  @Get("/ping")
  ping() {
    return "pong";
  }
}

// Controlador normal retornando un archivo manual
@Controller("api/downloads")
class DownloadController {
  // Este endpoint retorna un StaticFile con opciones para forzar descarga y nombre personalizado.
  @Get("/invoice")
  downloadInvoice() {
    return new StaticFile("report.pdf", {
      root: SCOPED_DIR,
      attachment: true,
      customName: "Factura_Final.pdf",
    });
  }

  // Este endpoint intenta servir un archivo que no existe, pero tiene un fallback
  // configurado para servir otro archivo en su lugar.
  @Get("/fallback")
  downloadWithFallback() {
    return new StaticFile("no-existe.txt", {
      root: SCOPED_DIR,
      fallback: "secret.txt",
    });
  }
}

// Módulo de prueba que incluye ambos controladores
@Module({
  controllers: [ScopedStaticController, DownloadController],
})
class StaticTestModule {}

describe("Integracion Archivos Estaticos (Static Assets)", () => {
  let app: FastifyInstance;

  // Antes de todas las pruebas, configuramos los archivos de prueba y creamos la aplicación FastifyKit
  beforeAll(async () => {
    setupTestFiles();

    // Creamos la aplicación FastifyKit con el módulo de prueba y la configuración de StaticAssets global
    app = await FastifyKit.create({
      module: StaticTestModule,
      staticAssets: {
        root: GLOBAL_DIR,
        cache: "aggressive",
        listDirectory: true,
        index: false,
      },
      fastifyOptions: { logger: false },
    });
  });

  // Después de todas las pruebas, cerramos la aplicación y limpiamos los archivos de prueba
  afterAll(async () => {
    if (app) await app.close();
    cleanupTestFiles();
  });

  describe("StaticAssets Globales (Configuración Global en FastifyKit)", () => {
    it("Deberia servir archivos de la carpeta global bajo el prefijo configurado", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/public/style.css",
      });

      expect(response.statusCode).toBe(200);
      expect(response.payload).toBe("body { color: red; }");
      expect(response.headers["content-type"]).toContain("text/css");
      expect(response.headers["cache-control"]).toContain("max-age=31536000");
      expect(response.headers["cache-control"]).toContain("immutable");
    });

    it("Deberia retornar el listado del directorio (JSON) si listDirectory es true y no hay index", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/public/",
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.files).toBeDefined();
      expect(data.files).toContain("style.css");
      expect(data.files).toContain("index.html");
    });
  });

  describe("StaticAssets Scoped (Decorador de Controlador)", () => {
    it("Deberia servir archivos desde un controlador aislado", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/private-docs/secret.txt",
      });

      expect(response.statusCode).toBe(200);
      expect(response.payload).toBe("Top Secret Data");
      expect(response.headers["content-type"]).toContain("text/plain");
    });

    it("Deberia lanzar 404 si el archivo no existe en el scope", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/private-docs/fantasma.png",
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("Clase StaticFile", () => {
    it("Deberia servir un archivo específico y forzar su descarga con Content-Disposition", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/downloads/invoice",
      });

      expect(response.statusCode).toBe(200);
      expect(response.payload).toBe("Fake PDF Content");
      expect(response.headers["content-disposition"]).toBe(
        'attachment; filename="Factura_Final.pdf"',
      );
    });

    it("Deberia servir el archivo de fallback si el solicitado original no existe", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/downloads/fallback",
      });

      expect(response.statusCode).toBe(200);
      expect(response.payload).toBe("Top Secret Data");
    });
  });
});
