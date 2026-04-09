import {
  describe,
  it,
  expect,
  mock,
  spyOn,
  beforeEach,
  afterEach,
} from "bun:test";

import { container } from "../../../../src/container/DIContainer.js";
import { BunWsBridge } from "../../../../src/websockets/bun/BunWsBridge.js";
import { registerGateways } from "../../../../src/websockets/gateway.registry.js";

// Nos aseguramos de que el símbolo para metadata exista para simular los decoradores de los Gateways
const decoratorMetadataSymbol =
  (Symbol as any).metadata ?? Symbol.for("Symbol.metadata");

// Simulamos un Guard para probar la integración de preHandlers en el registro de rutas
class MockGuard {
  async canActivate() {
    await Promise.resolve(); // Simulamos async
    return true;
  }
}

// Simulamos un Gateway con decoradores para que el registry lo procese y registre la ruta con el BunWsBridge.
class MockGateway {
  static readonly [decoratorMetadataSymbol] = {
    wsGateway: { path: "/ws/seguro" },
    classGuards: [MockGuard],
    wsEvents: [
      { type: "connect", handlerName: "onInit" },
      { type: "message", pattern: "ping", handlerName: "onPing" },
    ],
  };

  async onInit() {}
  async onPing() {}
}

describe("Gateway Registry (Modo Bun Nativo)", () => {
  // Mocks y variables para simular el entorno de Bun y Fastify
  let mockApp: any;
  let originalNodeEnv: string | undefined;
  let originalMainServer: any;

  beforeEach(() => {
    // Simulamos la instancia de Fastify
    mockApp = {
      get: mock(),
      log: { info: mock(), error: mock(), warn: mock() },
      addHook: mock(),
    };

    // Evitamos que el DIContainer intente resolver dependencias reales
    spyOn(container, "resolve").mockImplementation((cls: any) => new cls());

    // Guardamos el valor original de NODE_ENV para restaurarlo después del test,
    // evitando así afectar otros tests que dependan de este valor
    originalNodeEnv = process.env.NODE_ENV;

    // Guardamos el valor original de Bun.mainServer para restaurarlo después del test,
    // evitando así errores de solo lectura en el objeto global Bun
    originalMainServer = (globalThis as any).Bun.mainServer;

    // Limpiamos el registro de gateways antes de cada test para evitar contaminación entre pruebas
    (BunWsBridge as any).registry.clear();
  });

  afterEach(() => {
    // Restauramos el valor original de NODE_ENV para no afectar otros tests
    process.env.NODE_ENV = originalNodeEnv;

    // Restauramos el valor original de Bun.mainServer para evitar errores de solo lectura en otros tests
    (globalThis as any).Bun.mainServer = originalMainServer;

    // Restauramos los mocks para evitar que afecten a otros tests
    mock.restore();
  });

  it("Debería registrar la ruta con preHandler (Guards) y delegar la lógica al BunWsBridge", () => {
    // Simulamos el entorno de producción
    process.env.NODE_ENV = "production";
    // Simulamos la funcion de upgrade de Bun para verificar que se llama
    // con los datos correctos desde el preHandler del registry
    const mockUpgrade = mock().mockReturnValue(true);

    // Inyectamos el mock directamente en mainServer sin tocar el objeto Bun de solo lectura
    (globalThis as any).Bun.mainServer = { upgrade: mockUpgrade };

    // Espiamos el método register del BunWsBridge para verificar que se llama con la configuración correcta
    const bridgeSpy = spyOn(BunWsBridge, "register");

    // Ejecutamos el registro
    registerGateways(mockApp, [MockGateway]);

    // Validamos que el Bridge recibió la configuración correcta (onConnect/process/onDisconnect)
    expect(bridgeSpy).toHaveBeenCalledTimes(1);
    const [path, config] = bridgeSpy.mock.calls[0];
    expect(path).toBe("/ws/seguro");
    expect(typeof config.onConnect).toBe("function");
    expect(typeof config.process).toBe("function");
    expect(typeof config.onDisconnect).toBe("function");

    // Validamos que la ruta HTTP se registró con el escudo (preHandler)
    expect(mockApp.get).toHaveBeenCalledTimes(1);
    const [routePath, routeOpts, routeHandler] = mockApp.get.mock.calls[0];

    expect(routePath).toBe("/ws/seguro");
    expect(routeOpts.preHandler).toBeDefined(); // Verifica que el Guard está protegiendo la ruta

    // Validamos que el Upgrade conserva el contexto (path y request)
    const mockReq = { raw: { fakeRequest: true } };
    const mockReply = { code: mock().mockReturnThis(), send: mock() };

    // Simulamos que la petición pasó el Guard y Fastify ejecuta el handler
    routeHandler(mockReq, mockReply);

    // Verificamos que Bun hizo el upgrade con los datos exactos que el Bridge necesita
    expect(mockUpgrade).toHaveBeenCalledTimes(1);
    expect(mockUpgrade).toHaveBeenCalledWith(
      mockReq.raw,
      expect.objectContaining({
        data: {
          path: "/ws/seguro",
          request: mockReq, // El contexto se guardó correctamente para el WeakMap
        },
      }),
    );
  });
});
