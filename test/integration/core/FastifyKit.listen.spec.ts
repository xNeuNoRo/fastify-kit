import {
  describe,
  it,
  expect,
  mock,
  spyOn,
  beforeEach,
  afterEach,
} from "bun:test";
import type { FastifyInstance } from "fastify";

import { FastifyKit } from "../../../src/core/FastifyKit.js";

describe("FastifyKit (Orquestador de Arranque Híbrido)", () => {
  // Mocks para el servidor de Fastify y su método listen
  let mockApp: any;
  let originalNodeEnv: string | undefined;

  // Antes de cada test, preparamos un mock del servidor de Fastify y guardamos el estado original de NODE_ENV
  beforeEach(() => {
    // Preparamos el mock del servidor de Fastify con un método listen que podemos espiar
    mockApp = {
      listen: mock().mockResolvedValue(undefined),
      server: { emit: mock() },
      routing: mock(),
      log: { info: mock(), error: mock() },
    };
    // Guardamos el valor original de NODE_ENV para restaurarlo después del test
    originalNodeEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    // Restauramos el valor original de NODE_ENV después de cada test para no afectar otros tests
    process.env.NODE_ENV = originalNodeEnv;
    // Limpiamos los espías nativos de Bun
    mock.restore();
  });

  it("Debería usar app.listen() si no está en Bun o si está en entorno de test", async () => {
    // Forzamos el entorno de test para asegurarnos de que no detecta Bun incluso si estamos en él
    process.env.NODE_ENV = "test";

    // Ejecutamos el método que debería usar app.listen() en este caso
    await FastifyKit.listen(mockApp as FastifyInstance, 3000, "127.0.0.1");

    // Verificamos que se llamó a app.listen() con los argumentos correctos
    expect(mockApp.listen).toHaveBeenCalledTimes(1);
    // Verificamos que el host y el puerto se pasaron correctamente (Bun no los usaría, pero Fastify sí)
    expect(mockApp.listen).toHaveBeenCalledWith({
      port: 3000,
      host: "127.0.0.1",
    });
  });

  it("Debería usar Bun.serve() y puentear Fastify en producción", async () => {
    process.env.NODE_ENV = "production";

    // Espiamos Bun.serve para verificar que se llama correctamente
    const mockServe = spyOn(Bun, "serve").mockReturnValue({
      fakeBunServer: true,
    } as any);

    // Ejecutamos el método que debería detectar Bun y usar su servidor nativo
    await FastifyKit.listen(mockApp as FastifyInstance, 3000, "0.0.0.0");

    // Verificamos que no se llamó a app.listen() y sí a Bun.serve() con la configuración correcta
    expect(mockApp.listen).not.toHaveBeenCalled();
    expect(mockServe).toHaveBeenCalledTimes(1);

    // Verificamos que Bun.serve se llamó con los argumentos correctos para integrar Fastify
    const serveArgs = mockServe.mock.calls[0][0];
    expect(serveArgs.port).toBe(3000);
    expect(serveArgs.hostname).toBe("0.0.0.0");
    expect(typeof serveArgs.fetch).toBe("function");
    expect(typeof serveArgs.websocket).toBe("object");

    // Verificamos que el servidor de Bun se guardó en globalThis para que el registry de websockets funcione
    expect((globalThis as any).Bun.mainServer).toEqual({ fakeBunServer: true });
    expect(mockApp.log.info).toHaveBeenCalledWith(
      expect.stringContaining(
        "Servidor Bun (Native Bridge) activo en puerto 3000",
      ),
    );
  });
});
