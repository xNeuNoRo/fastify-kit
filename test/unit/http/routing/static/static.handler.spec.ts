import type { FastifyReply, FastifyInstance } from "fastify";
import fs from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { StaticFile } from "../../../../../src/http/responses/StaticFile.js";
import {
  handleStaticFileResponse,
  registerStaticAssetsPlugin,
} from "../../../../../src/http/routing/scanner/static/static.handler.js";

// Mockeamos el módulo 'fs' para controlar el comportamiento de existsSync
vi.mock("node:fs", () => {
  const existsSync = vi.fn();
  return {
    default: { existsSync },
    existsSync,
  };
});

describe("Handler orquestador de los archivos estaticos", () => {
  let mockReply: any;

  // Antes de cada test, reiniciamos el mock del reply
  beforeEach(() => {
    mockReply = {
      header: vi.fn(),
      sendFile: vi.fn(),
    };
    vi.clearAllMocks();
  });

  describe("Funcion handleStaticFileResponse()", () => {
    it("Deberia delegar la transmisión del archivo a reply.sendFile", () => {
      const file = new StaticFile("logo.png", { root: "/public" });
      handleStaticFileResponse(file, mockReply as FastifyReply);

      expect(mockReply.sendFile).toHaveBeenCalledWith("logo.png", "/public");
      expect(mockReply.header).not.toHaveBeenCalled();
    });

    it("Deberia cambiar al archivo fallback si el original no existe físicamente", () => {
      // Simulamos que fs.existsSync devuelve false (no encuentra el archivo)
      (fs.existsSync as any).mockReturnValue(false);

      const file = new StaticFile("missing.png", {
        root: "/public",
        fallback: "default.png",
      });

      handleStaticFileResponse(file, mockReply as FastifyReply);

      expect(fs.existsSync).toHaveBeenCalled();
      expect(mockReply.sendFile).toHaveBeenCalledWith("default.png", "/public");
    });

    it("Deberia inyectar la cabecera Content-Disposition si attachment es true", () => {
      const file = new StaticFile("factura_123.pdf", {
        root: "/docs",
        attachment: true,
        customName: "Mi_Factura.pdf",
      });

      handleStaticFileResponse(file, mockReply as FastifyReply);

      expect(mockReply.header).toHaveBeenCalledWith(
        "Content-Disposition",
        'attachment; filename="Mi_Factura.pdf"',
      );
      expect(mockReply.sendFile).toHaveBeenCalledWith(
        "factura_123.pdf",
        "/docs",
      );
    });
  });

  describe("Funcion registerStaticAssetsPlugin", () => {
    it("Deberia registrar el plugin de forma global si decorateReply es true (Modo Core)", async () => {
      const mockApp = { register: vi.fn() } as unknown as FastifyInstance;

      await registerStaticAssetsPlugin(
        mockApp,
        { root: "/public" },
        "public",
        undefined,
        true,
      );

      expect(mockApp.register).toHaveBeenCalled();
      const [, options] = (mockApp.register as any).mock.calls[0];

      expect(options.decorateReply).toBe(true);
      expect(options.prefix).toBe("/public/");
    });

    it("Deberia mapear correctamente las opciones avanzadas (caché, listDirectory)", async () => {
      const mockApp = { register: vi.fn() } as unknown as FastifyInstance;

      await registerStaticAssetsPlugin(
        mockApp,
        {
          root: "/public",
          cache: "aggressive",
          listDirectory: { format: "html" },
        },
        "public",
        undefined,
        true,
      );

      const [, options] = (mockApp.register as any).mock.calls[0];

      expect(options.maxAge).toBe("365d");
      expect(options.immutable).toBe(true);
      expect(options.list.format).toBe("html");
      expect(typeof options.list.render).toBe("function");
    });

    it("Deberia encapsular el registro si decorateReply es false (Modo Scanner)", async () => {
      // Mockeamos la app para que cuando llame a register() con un callback, ejecute ese callback
      const mockApp = {
        register: vi.fn(async (cb) => {
          if (typeof cb === "function") {
            await cb(
              { addHook: vi.fn(), register: vi.fn() } as any,
              {},
              () => {},
            );
          }
        }),
      } as unknown as FastifyInstance;

      // Registramos sin decorateReply, lo que debería hacer que se ejecute
      // el callback de register() y registre el plugin internamente
      await registerStaticAssetsPlugin(
        mockApp,
        { root: "/private" },
        "private",
      );

      expect(mockApp.register).toHaveBeenCalled();

      // Verificamos que se le pasó una función asíncrona de encapsulamiento
      expect(typeof (mockApp.register as any).mock.calls[0][0]).toBe(
        "function",
      );
    });
  });
});
