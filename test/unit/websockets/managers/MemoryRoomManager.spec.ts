import { describe, it, expect, beforeEach, vi } from "vitest";

import type { FastifyKitSocket } from "../../../../src/websockets/interfaces/FastifyKitSocket.js";
import { MemoryRoomManager } from "../../../../src/websockets/managers/MemoryRoomManager.js";

describe("Gestor de Salas en Memoria (MemoryRoomManager)", () => {
  let roomManager: MemoryRoomManager;

  beforeEach(() => {
    // Instanciamos el manager limpio antes de cada test
    roomManager = new MemoryRoomManager();
  });

  // Utilidad para generar sockets mockeados rápidamente en las pruebas
  const createMockSocket = (
    id: string,
    namespace: string = "/chat",
  ): FastifyKitSocket => {
    return {
      id,
      namespace,
      readyState: 1, // 1 = OPEN
      data: {},
      send: vi.fn(),
      join: vi.fn(),
      leave: vi.fn(),
      leaveAll: vi.fn(),
      to: vi.fn(),
    } as unknown as FastifyKitSocket;
  };

  describe("metodos join() y getSocketsInRoom()", () => {
    it("Debería añadir un socket a una sala específica y poder recuperarlo", async () => {
      const socket = createMockSocket("socket-1", "/chat");

      // El socket se une a la sala "general" en el namespace "/chat"
      await roomManager.join("/chat", "general", socket.id, socket);

      const sockets = await roomManager.getSocketsInRoom("/chat", "general");

      expect(sockets).toHaveLength(1);
      expect(sockets[0].id).toBe("socket-1");
      expect(sockets[0].namespace).toBe("/chat");
    });

    it("Debería aislar estrictamente las salas con el mismo nombre pero diferente namespace", async () => {
      const socketChat = createMockSocket("socket-chat", "/chat");
      const socketNotif = createMockSocket("socket-notif", "/notificaciones");

      // Ambos se unen a una sala llamada "general", pero en distintos namespaces
      await roomManager.join("/chat", "general", socketChat.id, socketChat);
      await roomManager.join(
        "/notificaciones",
        "general",
        socketNotif.id,
        socketNotif,
      );

      const chatSockets = await roomManager.getSocketsInRoom(
        "/chat",
        "general",
      );
      const notifSockets = await roomManager.getSocketsInRoom(
        "/notificaciones",
        "general",
      );

      // Verificamos que no haya colisión de sockets (Multiplexing O(1) funcionando)
      expect(chatSockets).toHaveLength(1);
      expect(chatSockets[0].id).toBe("socket-chat");

      expect(notifSockets).toHaveLength(1);
      expect(notifSockets[0].id).toBe("socket-notif");
    });

    it("Debería retornar un array vacío si se consulta una sala que no existe", async () => {
      const sockets = await roomManager.getSocketsInRoom(
        "/chat",
        "sala-fantasma",
      );
      expect(sockets).toEqual([]);
    });
  });
});
