import { describe, it, expect, beforeEach, vi } from "vitest";

import { container } from "../../../../src/container/DIContainer.js";
import {
  WsBroadcaster,
  broadcastToRoom,
  broadcastToRooms,
} from "../../../../src/websockets/broadcaster/WsBroadcaster.js";
import * as roomManagerFactory from "../../../../src/websockets/managers/room-manager.factory.js";

// Mockeamos la factory del RoomManager para controlar su comportamiento en las pruebas
vi.mock("../../../../src/websockets/managers/room-manager.factory.js", () => ({
  getRoomManager: vi.fn(),
}));

describe("WsBroadcaster y Facades", () => {
  let broadcaster: WsBroadcaster;
  let mockRoomManager: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Preparamos un mock del RoomManager
    mockRoomManager = {
      emitToRoom: vi.fn().mockResolvedValue(undefined),
    };

    // Obligamos a la factory a devolver nuestro mock
    (roomManagerFactory.getRoomManager as any).mockReturnValue(mockRoomManager);

    broadcaster = new WsBroadcaster();
  });

  describe("Clase WsBroadcaster (@Injectable)", () => {
    it("Debería delegar la emisión a una sala específica usando el RoomManager activo", async () => {
      await broadcaster.emitToRoom("/chat", "general", "mensaje-nuevo", {
        texto: "hola",
      });

      expect(roomManagerFactory.getRoomManager).toHaveBeenCalledTimes(1);
      expect(mockRoomManager.emitToRoom).toHaveBeenCalledWith(
        "/chat",
        "general",
        "mensaje-nuevo",
        { texto: "hola" },
        expect.any(Object),
        undefined, // excludeSockets
      );
    });

    it("Debería emitir a múltiples salas en paralelo usando Promise.all", async () => {
      await broadcaster.emitToRooms("/chat", ["sala-1", "sala-2"], "alerta", {
        nivel: "alto",
      });

      expect(mockRoomManager.emitToRoom).toHaveBeenCalledTimes(2);
      expect(mockRoomManager.emitToRoom).toHaveBeenCalledWith(
        "/chat",
        "sala-1",
        "alerta",
        { nivel: "alto" },
        expect.any(Object),
        undefined, // excludeSockets
      );
      expect(mockRoomManager.emitToRoom).toHaveBeenCalledWith(
        "/chat",
        "sala-2",
        "alerta",
        { nivel: "alto" },
        expect.any(Object),
        undefined, // excludeSockets
      );
    });
  });

  describe("Facades Globales (Azúcar Sintáctico)", () => {
    it("broadcastToRoom debería resolver el broadcaster del contenedor y emitir", async () => {
      // Espiamos el contenedor real para verificar que se resuelve el broadcaster correctamente
      const resolveSpy = vi
        .spyOn(container, "resolve")
        .mockReturnValue(broadcaster as any);
      const emitSpy = vi.spyOn(broadcaster, "emitToRoom");

      await broadcastToRoom("/admin", "alertas", "caida-servidor", { id: 1 });

      expect(resolveSpy).toHaveBeenCalledWith(WsBroadcaster);
      expect(emitSpy).toHaveBeenCalledWith(
        "/admin",
        "alertas",
        "caida-servidor",
        { id: 1 },
        undefined, // excludeSockets
        undefined, // customAdapter
      );

      resolveSpy.mockRestore(); // Limpiamos el espía
    });

    it("broadcastToRooms debería resolver el broadcaster y emitir a varias salas", async () => {
      // Espiamos el contenedor real para verificar que se resuelve el broadcaster correctamente
      const resolveSpy = vi
        .spyOn(container, "resolve")
        .mockReturnValue(broadcaster as any);
      const emitSpy = vi.spyOn(broadcaster, "emitToRooms");

      await broadcastToRooms("/admin", ["salaA", "salaB"], "notificacion", {
        ok: true,
      });

      expect(resolveSpy).toHaveBeenCalledWith(WsBroadcaster);
      expect(emitSpy).toHaveBeenCalledWith(
        "/admin",
        ["salaA", "salaB"],
        "notificacion",
        { ok: true },
        undefined, // excludeSockets
        undefined, // customAdapter
      );

      resolveSpy.mockRestore(); // Limpiamos el espía
    });
  });
});
