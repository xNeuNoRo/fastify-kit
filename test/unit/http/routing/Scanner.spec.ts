import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { container } from "../../../../src/container/DIContainer.js";
import { ForbiddenException } from "../../../../src/http/exceptions/index.js";
import { ApiResponse } from "../../../../src/http/responses/ApiResponse.js";
import { registerControllers } from "../../../../src/http/routing/scanner.js";
import { LOGGER_TOKEN } from "../../../../src/logger/LoggerContract.js";

declare global {
  interface SymbolConstructor {
    metadata: symbol;
  }
}

// Aseguramos que Symbol.metadata exista para almacenar la metadata de los controladores
if (!Symbol.metadata) {
  Symbol.metadata = Symbol.for("Symbol.metadata");
}

describe("Motor de Enrutamiento (Scanner)", () => {
  // Variables para mocks y espías
  let mockApp: any;
  let loggerMock: any;
  let instancesCache: Map<any, any>;

  beforeEach(() => {
    // Mock de la instancia de Fastify con métodos espías para cada verbo HTTP
    mockApp = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      patch: vi.fn(),
    };

    // Mock del logger con métodos espías para verificar llamadas a logger.warn, logger.error, etc.
    loggerMock = {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    // Cache para simular el comportamiento del contenedor de inyección de dependencias
    // en la resolución de controladores y sus dependencias (Singletones)
    instancesCache = new Map();
    container.registerInstance(LOGGER_TOKEN, loggerMock);

    // Espiamos el contenedor para simular el comportamiento singleton de las dependencias
    vi.spyOn(container, "resolve").mockImplementation((cls) => {
      // Si se solicita el LOGGER_TOKEN, devolvemos nuestro mock de logger
      if (cls === LOGGER_TOKEN) return loggerMock;

      if (typeof cls === "function") {
        // Si no hemos creado esta clase aún, la instanciamos y la guardamos
        if (!instancesCache.has(cls)) {
          instancesCache.set(cls, new (cls as any)());
        }
        // Devolvemos SIEMPRE la misma instancia guardada en caché
        return instancesCache.get(cls);
      }
      return null;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Registro de Controladores", () => {
    it("Debería advertir si un controlador no tiene rutas definidas", () => {
      class EmptyController {
        dummy = true;
      }
      // No le ponemos decoradores, por ende no tiene metadata de rutas

      registerControllers(mockApp, [EmptyController]);

      // Deberia haber llamado a logger.warn al menos una vez indicando que no se encontraron rutas
      expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    });

    it("Debería construir rutas correctamente con prefijos y versiones", () => {
      const metadataSymbol = Symbol.metadata;
      class TestController {
        dummy = true;
      }

      // Simulamos manualmente lo que harían @Controller y @Get al definir la metadata en el controlador
      (TestController as any)[metadataSymbol] = {
        prefix: "users",
        version: "1",
        routes: [
          { method: "get", path: "/profile", handlerName: "getProfile" },
        ],
      };

      registerControllers(mockApp, [TestController]);

      // Verificamos que llamó a app.get() con la ruta normalizada: /v1/users/profile
      expect(mockApp.get).toHaveBeenCalledWith(
        "/v1/users/profile",
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("Debería registrar correctamente el Schema y la configuración de RateLimit en las opciones de Fastify", () => {
      // Para este test, simulamos un controlador con una ruta que tiene un schema y una configuración de rate limit.
      const metadataSymbol = Symbol.metadata;
      class ConfiguredController {
        dummy = true;
      }

      // Definimos un schema y una configuración de rate limit para simular lo que haría un esquema de Typebox y @RateLimit()
      const mySchema = { body: { type: "object" } };
      const myRateLimit = { max: 10, timeWindow: 60000 };

      // Simulamos la metadata que el decorador @Post() con un schema de Typebox y @RateLimit() habrían definido en el controlador
      (ConfiguredController as any)[metadataSymbol] = {
        routes: [
          {
            method: "post",
            path: "/config",
            handlerName: "configMethod",
            schema: mySchema,
          },
        ],
        rateLimits: { configMethod: myRateLimit },
      };

      registerControllers(mockApp, [ConfiguredController]);

      const options = mockApp.post.mock.calls[0][1];

      // Verificamos que el schema y el rate limit se inyectaron
      expect(options).toBeDefined();
      expect(options.schema).toBe(mySchema);
      expect(options.config.rateLimit).toBe(myRateLimit);
    });
  });

  describe("Lógica de Guards (preHandler)", () => {
    it("Debería ejecutar Guards y lanzar ForbiddenException si fallan", async () => {
      const metadataSymbol = Symbol.metadata;
      class AuthGuard {
        async canActivate() {
          await Promise.resolve(); // Simulamos una operación asíncrona
          return false;
        }
      } // Siempre falla

      class SecureController {
        async secret() {
          await Promise.resolve(); // Simulamos una operación asíncrona
          return "data";
        }
      }

      // Simulamos la metadata que el decorador @UseGuard(AuthGuard) y @Get() habrían definido en el controlador
      (SecureController as any)[metadataSymbol] = {
        routes: [{ method: "get", path: "/secret", handlerName: "secret" }],
        classGuards: [AuthGuard],
      };

      registerControllers(mockApp, [SecureController]);

      // Extraemos el preHandler registrado en Fastify
      const options = mockApp.get.mock.calls[0][1];
      const preHandler = options.preHandler;

      // Simulamos una petición de Fastify con objetos req y reply vacíos, ya que el guard no debería depender de ellos para esta prueba
      const mockReq = {} as any;
      const mockReply = {} as any;

      // Al ejecutar el preHandler, debería explotar con ForbiddenException
      await expect(preHandler(mockReq, mockReply)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("Debería continuar la ejecución si el Guard retorna true", async () => {
      const metadataSymbol = Symbol.metadata;
      class PassGuard {
        async canActivate() {
          await Promise.resolve(); // Simulamos una operación asíncrona
          return true;
        }
      }

      class SuccessSecureController {
        async ok() {
          await Promise.resolve(); // Simulamos una operación asíncrona
          return "data";
        }
      }

      // Simulamos la metadata que el decorador @UseGuard(PassGuard) y @Get() habrían definido en el controlador
      (SuccessSecureController as any)[metadataSymbol] = {
        routes: [{ method: "get", path: "/ok", handlerName: "ok" }],
        classGuards: [PassGuard],
      };

      registerControllers(mockApp, [SuccessSecureController]);

      const options = mockApp.get.mock.calls[0][1];
      const preHandler = options.preHandler;

      // Al ejecutar el preHandler y el guard retornar true, la promesa debe resolverse sin lanzar error
      await expect(preHandler({}, {})).resolves.toBeUndefined();
    });

    it("No debería inyectar preHandler si no hay Guards definidos", () => {
      const metadataSymbol = Symbol.metadata;
      class NoGuardController {
        dummy = true;
      }

      // Simulamos la metadata que el decorador @Get() habría definido en el controlador, pero sin ningún guard
      (NoGuardController as any)[metadataSymbol] = {
        routes: [{ method: "get", path: "/free", handlerName: "free" }],
      };

      registerControllers(mockApp, [NoGuardController]);

      const options = mockApp.get.mock.calls[0][1];
      // Si no hay guards, preHandler no debe existir para evitar overhead de Fastify
      expect(options).toBeDefined();
      expect(options.preHandler).toBeUndefined();
    });
  });

  describe("Inyección de Argumentos y Pipes", () => {
    it("Debería extraer parámetros del Request y aplicar Pipes", async () => {
      const metadataSymbol = Symbol.metadata;

      class ParseIntPipe {
        transform(value: any) {
          return Number.parseInt(value, 10);
        }
      }

      class ParamController {
        async findOne(id: number) {
          await Promise.resolve(); // Simulamos una operación asíncrona
          return id;
        }
      }

      // Simulamos la metadata que los decoradores @Get("/:id") y @Param("id", ParseIntPipe) habrían definido en el controlador
      (ParamController as any)[metadataSymbol] = {
        routes: [{ method: "get", path: "/:id", handlerName: "findOne" }],
        parameters: {
          findOne: [{ index: 0, type: "param", key: "id", pipe: ParseIntPipe }],
        },
      };

      registerControllers(mockApp, [ParamController]);

      // Obtenemos el handler principal que registra el scanner
      const handler = mockApp.get.mock.calls[0][2];

      // Simulamos una petición de Fastify donde el ID viene como string "123"
      const mockReq = { params: { id: "123" } } as any;
      const mockReply = { sent: false } as any;

      const result = await handler(mockReq, mockReply);

      // El resultado debe ser 123 (número) gracias al Pipe
      // Y debe venir envuelto en ApiResponse.success() por el formatResponse
      expect(result).toBeDefined();
      expect(result).toBeInstanceOf(ApiResponse);
      expect(result.data).toBe(123);
    });

    it("Debería pasar (request, reply) directamente si no hay decoradores de parámetros", async () => {
      const metadataSymbol = Symbol.metadata;
      class LegacyController {
        // Simulamos un espía en el método
        legacyMethod = vi.fn().mockResolvedValue("legacy ok");
      }

      // Simulamos la metadata que el decorador @Get() habría definido en el controlador, pero sin ningún decorador de parámetros
      (LegacyController as any)[metadataSymbol] = {
        routes: [
          { method: "get", path: "/legacy", handlerName: "legacyMethod" },
        ],
        parameters: {}, // Sin parámetros
      };

      registerControllers(mockApp, [LegacyController]);

      // Obtenemos el handler principal que registra el scanner
      const handler = mockApp.get.mock.calls[0][2];
      const mockReq = { id: 1 } as any;
      const mockReply = { sent: false } as any;

      // Al no haber decoradores de parámetros, el handler debería inyectar (req, reply) directamente en el método del controlador
      await handler(mockReq, mockReply);

      // Verificamos que se inyectó req y reply en el orden nativo de Fastify
      const instanceMock = container.resolve(LegacyController);
      expect(instanceMock.legacyMethod).toHaveBeenCalledWith(
        mockReq,
        mockReply,
      );
    });

    it("Debería resolver todos los tipos de parámetros (body, query, headers, req, res, ip) con y sin key", async () => {
      const metadataSymbol = Symbol.metadata;

      class MultiParamController {
        multiMethod = vi.fn().mockResolvedValue("multi ok");
      }

      // Simulamos la metadata que los decoradores de parámetros habrían definido
      // en el controlador para cubrir todos los tipos de inyección posibles
      (MultiParamController as any)[metadataSymbol] = {
        routes: [
          { method: "post", path: "/multi", handlerName: "multiMethod" },
        ],
        parameters: {
          multiMethod: [
            { index: 0, type: "body", key: "name" }, // req.body.name
            { index: 1, type: "query" }, // req.query completo
            { index: 2, type: "headers", key: "x-token" }, // req.headers['x-token']
            { index: 3, type: "request" }, // req
            { index: 4, type: "reply" }, // reply
            { index: 5, type: "ip" }, // req.ip
          ],
        },
      };

      registerControllers(mockApp, [MultiParamController]);

      // Obtenemos el handler principal que registra el scanner
      const handler = mockApp.post.mock.calls[0][2];

      // Simulamos una petición de Fastify con body, query, headers, ip, etc.
      const mockReq = {
        body: { name: "Angel" },
        query: { page: 1 },
        headers: { "x-token": "123" },
        ip: "127.0.0.1",
      } as any;
      const mockReply = { sent: false } as any;

      // Al ejecutar el handler, debería resolver e inyectar correctamente todos los parámetros en el método del controlador
      await handler(mockReq, mockReply);

      // Verificamos que se inyectaron los parámetros correctos en el orden definido por los índices
      const instanceMock = container.resolve(MultiParamController);
      // El orden de los parámetros debe ser: body.name, query, headers['x-token'], req, reply, ip
      expect(instanceMock.multiMethod).toHaveBeenCalledWith(
        "Angel", // index 0
        { page: 1 }, // index 1
        "123", // index 2
        mockReq, // index 3
        mockReply, // index 4
        "127.0.0.1", // index 5
      );
    });
  });

  describe("Extracción de Archivos Multipart (@File)", () => {
    it("Debería lanzar BadRequestException si la petición no es multipart", async () => {
      const metadataSymbol = Symbol.metadata;
      class FileController {
        async upload(file: any) {
          await Promise.resolve(); // Simulamos una operación asíncrona
          return file;
        }
      }

      // Simulamos metadata de @UseParams(File("avatar"))
      (FileController as any)[metadataSymbol] = {
        routes: [{ method: "post", path: "/upload", handlerName: "upload" }],
        parameters: { upload: [{ index: 0, type: "file", key: "avatar" }] },
      };

      registerControllers(mockApp, [FileController]);
      const handler = mockApp.post.mock.calls[0][2];

      // Simulamos un Request normal (sin isMultipart o que devuelve false)
      const mockReq = { isMultipart: () => false } as any;
      const mockReply = { sent: false } as any;

      await expect(handler(mockReq, mockReply)).rejects.toThrow();
    });

    it("Debería lanzar UnsupportedMediaTypeException si el archivo no coincide con los mimetypes permitidos", async () => {
      const metadataSymbol = Symbol.metadata;
      class MimeController {
        async upload(file: any) {
          await Promise.resolve(); // Simulamos una operación asíncrona
          return file;
        }
      }

      // Metadata con restricción de mimetype a solo PNG
      (MimeController as any)[metadataSymbol] = {
        routes: [{ method: "post", path: "/mime", handlerName: "upload" }],
        parameters: {
          upload: [
            {
              index: 0,
              type: "file",
              key: "documento",
              fileOptions: { mimetypes: ["image/png"] },
            },
          ],
        },
      };

      registerControllers(mockApp, [MimeController]);
      const handler = mockApp.post.mock.calls[0][2];

      // Simulamos que el usuario manda un PDF en lugar de un PNG
      const mockReq = {
        isMultipart: () => true,
        parts: async function* () {
          await Promise.resolve(); // Simulamos una operación asíncrona
          yield {
            type: "file",
            fieldname: "documento",
            mimetype: "application/pdf",
            toBuffer: vi.fn().mockResolvedValue(Buffer.from("pdf")),
            file: { truncated: false },
          };
        },
      } as any;

      await expect(handler(mockReq, { sent: false })).rejects.toThrow();
    });

    it("Debería procesar correctamente el archivo en modo Buffer", async () => {
      const metadataSymbol = Symbol.metadata;
      class BufferController {
        upload = vi.fn().mockResolvedValue("buffer ok");
      }

      (BufferController as any)[metadataSymbol] = {
        routes: [{ method: "post", path: "/buffer", handlerName: "upload" }],
        parameters: {
          upload: [
            {
              index: 0,
              type: "file",
              key: "avatar",
              fileOptions: { mode: "buffer" },
            },
          ],
        },
      };

      registerControllers(mockApp, [BufferController]);
      const handler = mockApp.post.mock.calls[0][2];

      // Mock de archivo válido en modo buffer
      const fakeBuffer = Buffer.from("contenido falso");
      const mockReq = {
        body: {},
        isMultipart: () => true,
        parts: async function* () {
          await Promise.resolve(); // Simulamos una operación asíncrona
          yield {
            type: "file",
            fieldname: "avatar",
            mimetype: "image/png",
            filename: "test.png",
            encoding: "7bit",
            toBuffer: vi.fn().mockResolvedValue(fakeBuffer),
            file: { truncated: false },
          };
        },
      } as any;

      await handler(mockReq, { sent: false });

      // Verificamos que se inyectó correctamente el objeto MultipartFile
      const instanceMock = container.resolve(BufferController);
      expect(instanceMock.upload).toHaveBeenCalledWith({
        filename: "test.png",
        mimetype: "image/png",
        encoding: "7bit",
        buffer: fakeBuffer,
      });
    });

    it("Debería atrapar el límite de Fastify y lanzar FileTooLargeException", async () => {
      const metadataSymbol = Symbol.metadata;
      class SizeController {
        async upload(file: any) {
          await Promise.resolve(); // Simulamos una operación asíncrona
          return file;
        }
      }

      (SizeController as any)[metadataSymbol] = {
        routes: [{ method: "post", path: "/size", handlerName: "upload" }],
        parameters: {
          upload: [
            {
              index: 0,
              type: "file",
              key: "avatar",
              fileOptions: { maxSize: 1024 },
            },
          ],
        },
      };

      registerControllers(mockApp, [SizeController]);
      const handler = mockApp.post.mock.calls[0][2];

      // Fastify lanza este error específico cuando el stream excede el tamaño en caliente
      const fastifyError = new Error("Limit reached");
      (fastifyError as any).code = "FST_REQ_FILE_TOO_LARGE";

      const mockReq = {
        isMultipart: () => true,
        parts: async function* () {
          await Promise.resolve(); // Simulamos una operación asíncrona
          const fastifyError = new Error("Limit reached");
          (fastifyError as any).code = "FST_REQ_FILE_TOO_LARGE";
          throw fastifyError;
        },
      } as any;

      await expect(handler(mockReq, { sent: false })).rejects.toThrow();
    });
  });

  describe("Extracción de Cookies (@Cookie)", () => {
    it("Debería lanzar error si se usa @Cookie pero el plugin no está activado", async () => {
      const metadataSymbol = Symbol.metadata;
      class BadCookieController {
        async get(cookie: string) {
          await Promise.resolve(); // Simulamos una operación asíncrona
          return cookie;
        }
      }

      (BadCookieController as any)[metadataSymbol] = {
        routes: [{ method: "get", path: "/nocookie", handlerName: "get" }],
        parameters: { get: [{ index: 0, type: "cookie", key: "token" }] },
      };

      registerControllers(mockApp, [BadCookieController]);
      const handler = mockApp.get.mock.calls[0][2];

      // Simulamos un Request SIN el plugin registrado (request.cookies es undefined)
      const mockReq = {} as any;
      const mockReply = { sent: false } as any;

      // Debe lanzar un error indicando que el plugin de cookies no está activado
      await expect(handler(mockReq, mockReply)).rejects.toThrow();
    });

    it("Debería extraer una cookie específica y también el objeto completo de cookies", async () => {
      const metadataSymbol = Symbol.metadata;
      class GoodCookieController {
        test = vi.fn().mockResolvedValue("cookie ok");
      }

      (GoodCookieController as any)[metadataSymbol] = {
        routes: [{ method: "get", path: "/cookie", handlerName: "test" }],
        parameters: {
          test: [
            { index: 0, type: "cookie", key: "token" },
            { index: 1, type: "cookie" },
          ],
        },
      };

      registerControllers(mockApp, [GoodCookieController]);
      const handler = mockApp.get.mock.calls[0][2];

      // Simulamos un Request CON el plugin de Fastify activo
      const fakeCookies = { token: "abc-123", theme: "dark" };
      const mockReq = { cookies: fakeCookies } as any;

      await handler(mockReq, { sent: false });

      const instanceMock = container.resolve(GoodCookieController);

      // Verificamos que se inyectó "abc-123" en el primer parámetro, y el objeto entero en el segundo
      expect(instanceMock.test).toBeDefined();
      expect(instanceMock.test).toHaveBeenCalledTimes(1);
      expect(instanceMock.test).toHaveBeenCalledWith("abc-123", fakeCookies);
    });
  });

  describe("Formateo de Respuesta (formatResponse)", () => {
    it("No debería hacer nada si la respuesta ya fue enviada (reply.sent)", async () => {
      const metadataSymbol = Symbol.metadata;
      class ReplyController {
        async manual(_req: any, reply: any) {
          reply.sent = true;
          await Promise.resolve(); // Simulamos una operación asíncrona
          return "manual data";
        }
      }

      // Simulamos la metadata que el decorador @Get() habría definido en el controlador
      (ReplyController as any)[metadataSymbol] = {
        routes: [{ method: "get", path: "/manual", handlerName: "manual" }],
      };

      registerControllers(mockApp, [ReplyController]);

      // Obtenemos el handler principal que registra el scanner
      const handler = mockApp.get.mock.calls[0][2];

      // Simulamos una petición de Fastify con un reply que ya tiene sent: true
      const mockReply = { sent: true } as any;
      const result = await handler({}, mockReply);

      // formatResponse retorna undefined si reply.sent es true para evitar enviar una respuesta adicional
      expect(result).toBeUndefined();
    });

    it("Debería retornar ApiResponse tal cual si el controlador ya la devuelve", async () => {
      const metadataSymbol = Symbol.metadata;
      const myResponse = ApiResponse.success({ custom: true });

      class CustomController {
        async get() {
          await Promise.resolve(); // Simulamos una operación asíncrona
          return myResponse;
        }
      }

      // Simulamos la metadata que el decorador @Get() habría definido en el controlador
      (CustomController as any)[metadataSymbol] = {
        routes: [{ method: "get", path: "/", handlerName: "get" }],
      };

      // Al registrar el controlador, obtenemos el handler principal que el scanner registra en Fastify
      registerControllers(mockApp, [CustomController]);

      // Obtenemos el handler principal que registra el scanner
      const handler = mockApp.get.mock.calls[0][2];

      // Simulamos una petición de Fastify con un reply que no ha enviado respuesta aún
      const result = await handler({}, { sent: false });

      // Si el controlador ya devuelve un ApiResponse, formatResponse no debe envolverlo nuevamente, sino retornarlo tal cual
      expect(result).toBe(myResponse);
    });
  });
});
