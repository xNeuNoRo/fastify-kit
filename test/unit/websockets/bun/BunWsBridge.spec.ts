import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { FastifyRequest } from "fastify";

import { BunWsBridge } from "../../../../src/websockets/bun/BunWsBridge.js";
import type { FastifyKitSocket } from "../../../../src/websockets/interfaces/FastifyKitSocket.js";

describe("Bun Native Bridge (BunWsBridge)", () => {
  // Definimos una ruta de prueba para simular la conexión a un Gateway específico
  const MOCK_PATH = "/ws/test";

  // Mocks de la configuración que inyecta el registry
  let mockConfig: any;
  // Mock del socket nativo que Bun nos entregaría
  let mockBunSocket: any;

  beforeEach(() => {
    // Preparamos los mocks para cada test para ver si se llaman correctamente
    mockConfig = {
      adapter: { decode: mock(), encode: mock() },
      onConnect: mock(),
      process: mock(),
      onDisconnect: mock(),
    };

    // Simulamos un socket nativo de Bun con la estructura mínima necesaria para las pruebas
    mockBunSocket = {
      data: {
        path: MOCK_PATH,
        request: { id: "req-123", headers: {} } as FastifyRequest,
      },
      send: mock(),
      close: mock(),
      readyState: 1,
    };

    // Limpiamos y registramos antes de cada test
    (BunWsBridge as any).registry.clear();
    BunWsBridge.register(MOCK_PATH, mockConfig);
  });

  it("Debería registrar la configuración del Gateway O(1)", () => {
    const config = (BunWsBridge as any).registry.get(MOCK_PATH);
    expect(config).toBeDefined();
    expect(config.onConnect).toBe(mockConfig.onConnect);
  });

  it("Debería enrutar el evento 'open' al método onConnect con el casteo correcto", async () => {
    const handler = BunWsBridge.handler;

    // Simulamos que el motor de Bun dispara el evento open
    await handler.open!(mockBunSocket);

    // Verificamos que llamó a nuestro framework con el socket y la request
    expect(mockConfig.onConnect).toHaveBeenCalledTimes(1);
    expect(mockConfig.onConnect).toHaveBeenCalledWith(
      mockBunSocket as unknown as FastifyKitSocket,
      mockBunSocket.data.request,
    );
  });

  it("Debería enrutar mensajes crudos (Buffer/String) al método process con velocidad máxima", async () => {
    const handler = BunWsBridge.handler;
    const incomingMessage = Buffer.from('{"event":"ping","data":"hello"}');

    // Simulamos que el motor de Bun dispara el evento open para establecer la conexión
    await handler.open!(mockBunSocket);

    // Simulamos que el motor de Bun dispara el evento message
    await handler.message(mockBunSocket, incomingMessage);

    // Verificamos que lo mandó a procesar sin alterar el payload
    expect(mockConfig.process).toHaveBeenCalledTimes(1);
    expect(mockConfig.process).toHaveBeenCalledWith(
      mockBunSocket as unknown as FastifyKitSocket,
      incomingMessage,
      mockBunSocket.data.request,
    );
  });

  it("Debería enrutar el evento 'close' al método onDisconnect para limpiar recursos", async () => {
    const handler = BunWsBridge.handler;

    // Simulamos que el motor de Bun dispara el evento open para establecer la conexión
    await handler.open!(mockBunSocket);

    // Simulamos que el motor de Bun dispara el evento close
    await handler.close!(mockBunSocket, 1000, "Normal Closure");

    // Verificamos que llamó a nuestro framework para la limpieza
    expect(mockConfig.onDisconnect).toHaveBeenCalledTimes(1);
    expect(mockConfig.onDisconnect).toHaveBeenCalledWith(
      mockBunSocket as unknown as FastifyKitSocket,
    );
  });
});
