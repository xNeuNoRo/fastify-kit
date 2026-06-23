import { beforeEach, afterEach, vi } from "vitest";
import { container } from "../src/container/DIContainer.js";
import { DefaultConfigService } from "../src/config/DefaultConfigService.js";
import { CONFIG_SERVICE_TOKEN } from "../src/config/ConfigService.js";

// ANTES de cada test, limpiamos dependencias y aseguramos un reloj real
beforeEach(() => {
  container.clearAll();
  // Re-registramos ConfigService después del clearAll para que todos los tests
  // tengan acceso al servicio de configuración inyectable (reemplaza al antiguo InternalConfig global)
  container.registerClass(CONFIG_SERVICE_TOKEN, DefaultConfigService);
  vi.useRealTimers();
});

// DESPUÉS de cada test, limpiamos mocks y por doble seguridad restauramos el reloj
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
