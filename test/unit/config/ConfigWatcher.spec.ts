import { watch } from "chokidar";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { ConfigWatcher } from "../../../src/config/ConfigWatcher.js";

vi.mock("chokidar", () => ({
  watch: vi.fn(),
}));

const mockWatch = watch as unknown as ReturnType<typeof vi.fn>;

describe("ConfigWatcher — Hot-Reload de Configuración", () => {
  let watcher: ConfigWatcher;

  beforeEach(() => {
    vi.clearAllMocks();
    // Silenciamos logs para tests limpios
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    watcher = new ConfigWatcher();
  });

  afterEach(() => {
    watcher.unwatch();
  });

  describe("constructor", () => {
    it("Debería usar 500ms como debounce por defecto", () => {
      // Verificamos indirectamente: watch() usa el debounce en setTimeout
      const mockFsWatcher = {
        on: vi.fn(),
        close: vi.fn(),
      };
      mockWatch.mockReturnValue(mockFsWatcher);

      vi.useFakeTimers();
      const onChange = vi.fn();
      watcher.watch([".env"], onChange);

      // Simulamos un cambio
      const changeHandler = mockFsWatcher.on.mock.calls.find(
        (call: unknown[]) => call[0] === "change",
      )?.[1];
      expect(changeHandler).toBeDefined();
      changeHandler!("/path/.env");

      // 300ms no debería disparar callback (debounce 500ms)
      vi.advanceTimersByTime(300);
      expect(onChange).not.toHaveBeenCalled();

      // 500ms sí debería disparar
      vi.advanceTimersByTime(200);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith("/path/.env");

      vi.useRealTimers();
    });

    it("Debería aceptar un debounceMs personalizado", () => {
      const fastWatcher = new ConfigWatcher(100);

      const mockFsWatcher = {
        on: vi.fn(),
        close: vi.fn(),
      };
      mockWatch.mockReturnValue(mockFsWatcher);

      vi.useFakeTimers();
      const onChange = vi.fn();
      fastWatcher.watch([".env"], onChange);

      const changeHandler = mockFsWatcher.on.mock.calls.find(
        (call: unknown[]) => call[0] === "change",
      )?.[1];
      changeHandler!("/path/.env");

      // Solo 100ms de debounce
      vi.advanceTimersByTime(100);
      expect(onChange).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
      fastWatcher.unwatch();
    });
  });

  describe("watch()", () => {
    it("Debería crear un watcher con las opciones correctas", () => {
      const mockFsWatcher = {
        on: vi.fn(),
        close: vi.fn(),
      };
      mockWatch.mockReturnValue(mockFsWatcher);

      watcher.watch([".env", "config.json"], vi.fn());

      expect(mockWatch).toHaveBeenCalledWith([".env", "config.json"], {
        ignoreInitial: true,
        persistent: false,
        awaitWriteFinish: {
          stabilityThreshold: 200,
          pollInterval: 100,
        },
      });
    });

    it("Debería registrar listeners 'change' y 'error'", () => {
      const mockFsWatcher = {
        on: vi.fn(),
        close: vi.fn(),
      };
      mockWatch.mockReturnValue(mockFsWatcher);

      watcher.watch([".env"], vi.fn());

      expect(mockFsWatcher.on).toHaveBeenCalledWith(
        "change",
        expect.any(Function),
      );
      expect(mockFsWatcher.on).toHaveBeenCalledWith(
        "error",
        expect.any(Function),
      );
    });

    it("Debería ejecutar el callback onChange cuando se detecta un cambio", () => {
      const mockFsWatcher = {
        on: vi.fn(),
        close: vi.fn(),
      };
      mockWatch.mockReturnValue(mockFsWatcher);

      vi.useFakeTimers();
      const onChange = vi.fn();
      watcher.watch([".env"], onChange);

      const changeHandler = mockFsWatcher.on.mock.calls.find(
        (call: unknown[]) => call[0] === "change",
      )?.[1];
      changeHandler!("/path/.env");

      vi.advanceTimersByTime(500);
      expect(onChange).toHaveBeenCalledWith("/path/.env");
      expect(onChange).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it("Debería aplicar debounce a cambios rápidos consecutivos", () => {
      const mockFsWatcher = {
        on: vi.fn(),
        close: vi.fn(),
      };
      mockWatch.mockReturnValue(mockFsWatcher);

      vi.useFakeTimers();
      const onChange = vi.fn();
      watcher.watch([".env"], onChange);

      const changeHandler = mockFsWatcher.on.mock.calls.find(
        (call: unknown[]) => call[0] === "change",
      )?.[1];

      // 3 cambios rápidos
      changeHandler!("/path/.env");
      vi.advanceTimersByTime(100);
      changeHandler!("/path/.env.local");
      vi.advanceTimersByTime(100);
      changeHandler!("/path/.env.development");

      // Todavía no debería haber llamado onChange
      expect(onChange).not.toHaveBeenCalled();

      // Avanzamos hasta después del debounce
      vi.advanceTimersByTime(500);
      expect(onChange).toHaveBeenCalledTimes(1);
      // Solo el último cambio notifica
      expect(onChange).toHaveBeenCalledWith("/path/.env.development");

      vi.useRealTimers();
    });

    it("Debería detener el watcher anterior si se llama watch() de nuevo", () => {
      const mockFsWatcher1 = {
        on: vi.fn(),
        close: vi.fn(),
      };
      const mockFsWatcher2 = {
        on: vi.fn(),
        close: vi.fn(),
      };
      mockWatch
        .mockReturnValueOnce(mockFsWatcher1)
        .mockReturnValueOnce(mockFsWatcher2);

      watcher.watch([".env"], vi.fn());
      expect(mockFsWatcher1.close).not.toHaveBeenCalled();

      watcher.watch([".env.local"], vi.fn());
      // El watcher anterior debe cerrarse
      expect(mockFsWatcher1.close).toHaveBeenCalledTimes(1);
    });
  });

  describe("unwatch()", () => {
    it("Debería detener el watcher activo", () => {
      const mockFsWatcher = {
        on: vi.fn(),
        close: vi.fn(),
      };
      mockWatch.mockReturnValue(mockFsWatcher);

      watcher.watch([".env"], vi.fn());
      watcher.unwatch();

      expect(mockFsWatcher.close).toHaveBeenCalledTimes(1);
    });

    it("Debería limpiar el timer de debounce pendiente", () => {
      const mockFsWatcher = {
        on: vi.fn(),
        close: vi.fn(),
      };
      mockWatch.mockReturnValue(mockFsWatcher);

      vi.useFakeTimers();
      const onChange = vi.fn();
      watcher.watch([".env"], onChange);

      const changeHandler = mockFsWatcher.on.mock.calls.find(
        (call: unknown[]) => call[0] === "change",
      )?.[1];
      changeHandler!("/path/.env");

      // Hacemos unwatch antes de que termine el debounce
      watcher.unwatch();

      // Avanzamos más allá del debounce
      vi.advanceTimersByTime(1000);
      // onChange nunca debió ser llamado
      expect(onChange).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("Debería ser idempotente (no falla si se llama sin watcher activo)", () => {
      expect(() => watcher.unwatch()).not.toThrow();
      watcher.unwatch();
      watcher.unwatch();
    });
  });

  describe("Manejo de errores", () => {
    it("Debería loggear errores del watcher", () => {
      const mockFsWatcher = {
        on: vi.fn(),
        close: vi.fn(),
      };
      mockWatch.mockReturnValue(mockFsWatcher);

      watcher.watch([".env"], vi.fn());

      const errorHandler = mockFsWatcher.on.mock.calls.find(
        (call: unknown[]) => call[0] === "error",
      )?.[1];
      errorHandler!(new Error("Permiso denegado"));

      expect(console.error).toHaveBeenCalled();
    });

    it("Debería loggear errores no-Error (strings, objetos)", () => {
      const mockFsWatcher = {
        on: vi.fn(),
        close: vi.fn(),
      };
      mockWatch.mockReturnValue(mockFsWatcher);

      watcher.watch([".env"], vi.fn());

      const errorHandler = mockFsWatcher.on.mock.calls.find(
        (call: unknown[]) => call[0] === "error",
      )?.[1];
      errorHandler!("error como string");

      expect(console.error).toHaveBeenCalled();
    });
  });
});
