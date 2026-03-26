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
