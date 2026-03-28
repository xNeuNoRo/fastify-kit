import { Cron } from "croner";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { container } from "../../../src/container/DIContainer.js";
import { FastifyKit } from "../../../src/core/FastifyKit.js";
import { Module } from "../../../src/core/module.decorator.js";
import { Controller } from "../../../src/http/decorators/controller.js";
import { Get, Post } from "../../../src/http/decorators/methods.js";
import {
  UseParams,
  File,
  Cookie,
} from "../../../src/http/decorators/parameters.js";
import type { MultipartFile } from "../../../src/http/decorators/types.js";
import { Scheduled } from "../../../src/scheduling/scheduled.decorator.js";

// Aseguramos que el símbolo para metadata esté definido para poder usarlo en los tests
if (!(Symbol as any).metadata) {
  (Symbol as any).metadata = Symbol.for("Symbol.metadata");
}

describe("FastifyKit (Orquestador Core)", () => {
  // Definimos clases de prueba para controladores, servicios y módulos
  class TestCronService {
    public executed = false;
    @Scheduled("*/5 * * * * *")
    doTask() {
      this.executed = true;
    }
  }

  abstract class IMessageService {
    abstract getMessage(): string;
  }
  class MessageService implements IMessageService {
    getMessage() {
      return "Hola desde DI!";
    }
  }

  @Controller("/test")
  class TestController {
    constructor() {}

    @Get("/ping")
    ping() {
      const msgService = container.resolve(IMessageService);
      return { msg: msgService.getMessage() };
    }
  }

  @Module({
    providers: [{ contract: IMessageService, implementation: MessageService }],
    controllers: [TestController],
  })
  class SubModule {}

  @Module({
    imports: [SubModule],
    providers: [TestCronService],
  })
  class AppModule {}

  beforeEach(() => {
    container.clearAll(); // Limpiamos el contenedor antes de cada test para evitar contaminación entre pruebas
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Creación y Routing Base", () => {
    it("Debería crear la app, resolver recursivamente el árbol de módulos y responder a HTTP", async () => {
      const app = await FastifyKit.create({
        module: AppModule,
        globalPrefix: "/api/v1",
      });

      const healthRes = await app.inject({ method: "GET", url: "/health" });

      expect(healthRes.statusCode).toBe(200);
      expect(JSON.parse(healthRes.payload).data).toBeDefined();
      expect(JSON.parse(healthRes.payload).data).toBeTypeOf("object");
      expect(JSON.parse(healthRes.payload).data.status).toBeDefined();
      expect(JSON.parse(healthRes.payload).data.status).toBe("up");
      expect(JSON.parse(healthRes.payload)).toEqual({
        data: { status: "up" },
        ok: true,
        error: null,
        timestamp: expect.any(String),
      });

      const pingRes = await app.inject({
        method: "GET",
        url: "/api/v1/test/ping",
      });
      expect(pingRes.statusCode).toBe(200);
      expect(JSON.parse(pingRes.payload).data.msg).toBe("Hola desde DI!");

      await app.close();
    });

    it("Debería procesar la subida de un archivo real de extremo a extremo", async () => {
      // Definimos un controlador y módulo de prueba para manejar la subida de archivos usando el decorador @UseParams con File
      @Controller("/archivos")
      class UploadController {
        @Post("/subir")
        @UseParams(File("documento", { mode: "buffer" }))
        subirArchivo(doc: MultipartFile) {
          return {
            nombre: doc.filename,
            formato: doc.mimetype,
            bytes: doc.buffer?.length,
            contenido: doc.buffer?.toString("utf-8"),
          };
        }
      }

      @Module({ controllers: [UploadController] })
      class UploadModule {}

      // Creamos una instancia de FastifyKit con el módulo de subida de archivos y habilitamos multipart
      const app = await FastifyKit.create({
        module: UploadModule,
        multipart: true,
      });

      // Creamos un payload multipart real simulando la subida de un archivo de texto. Usamos una boundary personalizada para construir el cuerpo de la solicitud correctamente.
      const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
      const payloadHTTP =
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="documento"; filename="prueba.txt"\r\n` +
        `Content-Type: text/plain\r\n\r\n` +
        `Hola desde un test de integración\r\n` +
        `--${boundary}--\r\n`;

      // Inyectamos la solicitud POST al endpoint de subida de archivos con el payload multipart y el header Content-Type correcto
      const res = await app.inject({
        method: "POST",
        url: "/archivos/subir",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: payloadHTTP,
      });

      // Validamos que la respuesta haya sido exitosa
      expect(res.statusCode).toBe(200);

      // Validamos que el archivo haya sido procesado correctamente y que la información devuelta sea correcta
      const json = JSON.parse(res.payload);
      expect(json.data.nombre).toBe("prueba.txt");
      expect(json.data.formato).toBe("text/plain");
      expect(json.data.contenido).toBe("Hola desde un test de integración");
      expect(json.data.bytes).toBeGreaterThan(0);

      await app.close();
    });

    it("Debería lanzar error si el módulo raíz no es válido", async () => {
      class BadModule {
        dummy = true;
      }

      await expect(FastifyKit.create({ module: BadModule })).rejects.toThrow();
    });

    it("Debería procesar la lectura de cookies de extremo a extremo", async () => {
      // Controlador efímero para pruebas de cookies
      @Controller("/auth")
      class AuthController {
        @Get("/perfil")
        @UseParams(Cookie("session_id"))
        obtenerPerfil(sessionId: string) {
          // Si el decorador inyectó la cookie correcta, devolvemos true
          return { autenticado: sessionId === "xyz-789" };
        }
      }

      @Module({ controllers: [AuthController] })
      class AuthModule {}

      // Creamos la app con el módulo de autenticación y habilitamos cookies
      const app = await FastifyKit.create({
        module: AuthModule,
        cookies: true,
      });

      // Inyectamos una solicitud GET al endpoint de perfil con una cookie de sesión simulada en el header
      const res = await app.inject({
        method: "GET",
        url: "/auth/perfil",
        headers: {
          // Header como lo enviaría el navegador
          cookie: "theme=dark; session_id=xyz-789; lang=es",
        },
      });

      // Validamos que el Scanner hizo su magia
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.data.autenticado).toBe(true);

      await app.close();
    });

    it("Debería lanzar error si un proveedor está mal configurado", async () => {
      @Module({
        providers: [{ badConfig: true } as any],
      })
      class BrokenModule {}

      await expect(
        FastifyKit.create({ module: BrokenModule }),
      ).rejects.toThrow();
    });
  });

  describe("Registro de Plugins de Seguridad y Documentación", () => {
    it("Debería registrar CORS, Helmet y RateLimit si se habilitan", async () => {
      const app = await FastifyKit.create({
        module: AppModule,
        security: {
          enableCors: true,
          enableHelmet: true,
          rateLimit: { max: 10, timeWindow: "1m" },
        },
      });

      // CORRECCIÓN 1: Inyectamos el header 'Origin' para forzar a CORS a responder
      const res = await app.inject({
        method: "GET",
        url: "/health",
        headers: { origin: "http://localhost:5173" },
      });

      expect(res.headers["content-security-policy"]).toBeDefined();
      expect(res.headers["access-control-allow-origin"]).toBeDefined();
      expect(res.headers["x-ratelimit-limit"]).toBeDefined();

      await app.close();
    });

    it("Debería registrar Swagger/Scalar en la ruta /docs si se proporciona configuración", async () => {
      const app = await FastifyKit.create({
        module: AppModule,
        swagger: {
          title: "Test API",
          description: "Testing",
          version: "1.0",
        },
      });

      // Esperamos a que la app esté lista para asegurarnos de que Swagger/Scalar se haya registrado correctamente
      await app.ready();

      // Evaluamos la configuración interna directamente
      const openapiSchema = (app as any).swagger();
      expect(openapiSchema).toBeDefined();
      expect(openapiSchema.info.title).toBe("Test API");

      // Verificamos que Scalar levantó la UI correctamente
      const uiRes = await app.inject({ method: "GET", url: "/docs/" });
      expect(uiRes.statusCode).toBe(200);
      expect(uiRes.payload).toContain("Test API");

      await app.close();
    });
  });

  describe("Motor de Tareas Programadas (Cron)", () => {
    it("Debería instanciar servicios con @Schedule y limpiar los jobs en onClose", async () => {
      const cronStopSpy = vi.spyOn(Cron.prototype, "stop");

      const app = await FastifyKit.create({ module: AppModule });

      const cronService = container.resolve(TestCronService);
      expect(cronService).toBeDefined();

      await app.close();

      expect(cronStopSpy).toHaveBeenCalled();
    });
  });

  describe("Ramas Edge: Auto-Discovery, Deduplicación y AJV", () => {
    it("Debería llamar al Auto-Discovery y deduplicar proveedores compartidos", async () => {
      // Importamos y espiamos las funciones de discovery sin ejecutar el disco real
      const DiscoveryModule =
        await import("../../../src/http/routing/discovery.js");
      const discoverCtrlSpy = vi
        .spyOn(DiscoveryModule, "discoverControllers")
        .mockResolvedValue([]);
      const discoverModSpy = vi
        .spyOn(DiscoveryModule, "discoverModules")
        .mockResolvedValue([]);

      class SharedDatabaseService {
        dummy = true;
      }

      // Dos submódulos que proveen EXACTAMENTE el mismo servicio
      @Module({ providers: [SharedDatabaseService] })
      class SubModuleA {}

      @Module({ providers: [SharedDatabaseService] })
      class SubModuleB {}

      // El módulo raíz usa Auto-Discovery
      @Module({
        imports: [SubModuleA, SubModuleB],
        autoDiscoverControllers: { baseDir: "/dummy/controllers" },
        autoDiscoverModules: { baseDir: "/dummy/modules" },
      })
      class DiscoveryAppModule {}

      const app = await FastifyKit.create({
        module: DiscoveryAppModule,
        fastifyOptions: {
          // Simulamos que el usuario pasó opciones custom de AJV
          ajv: { customOptions: { removeAdditional: true } },
        },
      });

      // Verificamos que las ramas de Auto-Discovery se ejecutaron
      expect(discoverCtrlSpy).toHaveBeenCalledTimes(1);
      expect(discoverModSpy).toHaveBeenCalledTimes(1);

      // Si la deduplicación fallara, el contenedor de dependencias explotaría o
      // tendríamos comportamientos erráticos. Al llegar aquí, sabemos que funcionó.
      await app.close();
    });
  });
});
