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
} from "../../../../src/core/discovery.js";
import { LOGGER_TOKEN } from "../../../../src/logger/LoggerContract.js";
import { WsGatewayRegistry } from "../../../../src/websockets/WsGatewayRegistry.js";

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

  describe("Registro de Gateways WebSockets (registerGateways)", () => {
    // Usamos un símbolo para simular la metadata que el decorador @WebSocketGateway agregaría a la clase del gateway
    const metaSymbol = Symbol.for("Symbol.metadata");

    // Gateway Simulado
    class MockGateway {
      handleConnect = vi.fn();
      handleMessage = vi.fn().mockReturnValue({ ok: true });
      handleFirehose = vi.fn().mockReturnValue("Respuesta cruda"); // Simulamos un handler de firehose que devuelve una respuesta cruda (no JSON)
      handleDisconnect = vi.fn();
    }

    (MockGateway as any)[metaSymbol] = {
      wsGateway: { path: "/ws/mock" },
      wsEvents: [
        { type: "connect", handlerName: "handleConnect" },
        { type: "message", handlerName: "handleMessage", pattern: "PING" },
        { type: "message", handlerName: "handleFirehose" }, // Firehose (sin patrón)
        { type: "disconnect", handlerName: "handleDisconnect" },
      ],
      parameters: {},
    };

    // Antes de cada test, preparamos los mocks necesarios para simular el entorno de Fastify y los clientes WebSocket
    let appMock: any;
    let wsClientMock: any;
    let gatewayInstance: MockGateway;
    const tick = () => new Promise((resolve) => process.nextTick(resolve)); // Helper de limpieza de microtareas

    beforeEach(() => {
      wsClientMock = {
        isAlive: true,
        ping: vi.fn(),
        terminate: vi.fn(),
      };

      appMock = {
        get: vi.fn(),
        addHook: vi.fn(),
        websocketServer: {
          clients: new Set([wsClientMock]),
        },
      };

      gatewayInstance = new MockGateway();
      container.registerInstance(MockGateway, gatewayInstance);
    });

    // Después de cada test, restauramos los mocks para evitar interferencias entre tests
    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("Debería ignorar las clases que no poseen el decorador @WebSocketGateway", () => {
      class NormalClass {
        dummy = true;
      }
      new WsGatewayRegistry().registerGateways(appMock, [NormalClass]);
      expect(appMock.get).not.toHaveBeenCalled();
    });

    it("Debería iniciar un intervalo (Ping/Pong) para limpiar conexiones muertas y registrar el hook onClose", () => {
      // Usamos timers falsos para poder simular el paso del tiempo y verificar el comportamiento del ping/pong
      vi.useFakeTimers();

      new WsGatewayRegistry().registerGateways(appMock, [MockGateway]);
      expect(appMock.addHook).toHaveBeenCalledWith(
        "onClose",
        expect.any(Function),
      );

      // Simulamos que pasan 30 segundos
      vi.advanceTimersByTime(30000);
      expect(wsClientMock.ping).toHaveBeenCalledTimes(1);
      expect(wsClientMock.isAlive).toBe(false);

      // Simulamos que el cliente nunca respondió (pasan otros 30 segundos)
      vi.advanceTimersByTime(30000);
      expect(wsClientMock.terminate).toHaveBeenCalledTimes(1);
    });

    it("Debería ejecutar correctamente el ciclo de vida (Connect, Message JSON, Firehose Crudo, Disconnect)", async () => {
      new WsGatewayRegistry().registerGateways(appMock, [MockGateway]);
      const routeHandler = appMock.get.mock.calls[0][2];

      // Simulamos la conexión de un cliente WebSocket y capturamos los handlers registrados para cada evento
      const wsHandlers: Record<string, (data?: any) => void> = {};
      const connectionMock = {
        on: vi.fn((event, cb) => {
          wsHandlers[event] = cb;
        }),
        close: vi.fn(),
        send: vi.fn(),
        isAlive: false,
        readyState: 1, // Simulamos que la conexión está abierta
      };

      // Simulamos la conexión de un cliente WebSocket
      routeHandler(connectionMock, {} as any);
      await tick(); // Esperamos a que se ejecuten las microtareas pendientes

      // Verificamos que el handler de conexión se haya ejecutado y que la conexión esté marcada como viva
      expect(connectionMock.isAlive).toBe(true);
      expect(gatewayInstance.handleConnect).toHaveBeenCalled();

      // Simulamos el envío de un mensaje JSON con el patrón/evento "PING"
      wsHandlers["message"](
        Buffer.from(JSON.stringify({ event: "PING", data: "Hola" })),
      );
      // Esperamos a que se ejecuten las microtareas pendientes (incluyendo la respuesta del handler)
      await tick();
      await tick();

      // Verificamos que el handler de mensaje se haya ejecutado y que la respuesta correcta se haya enviado al cliente
      expect(gatewayInstance.handleMessage).toHaveBeenCalled();
      expect(connectionMock.send).toHaveBeenCalledWith(
        JSON.stringify({ event: "PING", data: { ok: true } }),
      );

      // Simulamos el envío de un mensaje que no tiene patrón/evento definido (Firehose)
      wsHandlers["message"](Buffer.from("MENSAJE_CUALQUIERA"));
      // Esperamos a que se ejecuten las microtareas pendientes (incluyendo la respuesta del handler de firehose)
      await tick();
      await tick();

      // Verificamos que el handler de firehose se haya ejecutado y que la respuesta cruda se haya enviado al cliente
      expect(gatewayInstance.handleFirehose).toHaveBeenCalled();
      expect(connectionMock.send).toHaveBeenCalledWith("Respuesta cruda");

      // Simulamos la desconexión del cliente
      wsHandlers["close"]();
      await tick();

      // Verificamos que el handler de desconexión se haya ejecutado
      expect(gatewayInstance.handleDisconnect).toHaveBeenCalled();
    });

    it("Debería responder 'ERROR:HANDLER_NOT_FOUND_FOR_PATTERN:<pattern>' si recibe un mensaje pero no hay handler registrado", async () => {
      class EmptyGateway {
        dummy = true;
      }
      (EmptyGateway as any)[metaSymbol] = {
        wsGateway: { path: "/ws/empty" },
        wsEvents: [], // No tiene firehose ni handler explicito (OnMessage)
        parameters: {},
      };

      // Registramos el gateway vacío en el contenedor y lo pasamos al registry para que lo registre normalmente
      container.registerInstance(EmptyGateway, new EmptyGateway());
      new WsGatewayRegistry().registerGateways(appMock, [EmptyGateway]);

      // Simulamos la conexión de un cliente WebSocket y capturamos los handlers registrados para cada evento
      const routeHandler = appMock.get.mock.calls[0][2];
      const wsHandlers: Record<string, (data?: any) => void> = {};
      const connectionMock = {
        on: vi.fn((event, cb) => {
          wsHandlers[event] = cb;
        }),
        send: vi.fn(),
        readyState: 1, // Simulamos que la conexión está abierta
      };

      // Simulamos la conexión de un cliente WebSocket
      routeHandler(connectionMock, {} as any);
      // Esperamos a que se ejecuten las microtareas pendientes
      await tick();

      // Mandamos un mensaje a un Gateway que no tiene listeners
      wsHandlers["message"](Buffer.from("Basura binaria"));
      await tick();
      await tick();

      // En lugar de tragarse el mensaje en silencio, el framework le avisa al cliente
      expect(connectionMock.send).toHaveBeenCalledWith(
        "ERROR:HANDLER_NOT_FOUND_FOR_PATTERN:null",
      );
    });
  });
});
