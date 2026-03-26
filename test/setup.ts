import { beforeEach, afterEach, vi } from "vitest";
import { container } from "../src/container/DIContainer.js";

// ANTES de cada test, limpiamos dependencias y aseguramos un reloj real
beforeEach(() => {
  container.clearAll();
  vi.useRealTimers();
});

// DESPUÉS de cada test, limpiamos mocks y por doble seguridad restauramos el reloj
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
