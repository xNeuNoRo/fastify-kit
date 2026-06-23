import { beforeEach, afterEach, vi } from "vitest";
import { container } from "../src/container/DIContainer.js";
import { DefaultConfigService } from "../src/config/DefaultConfigService.js";
import { CONFIG_SERVICE_TOKEN } from "../src/config/ConfigService.js";
import {
  QueueRegistryService,
  QUEUE_REGISTRY_TOKEN,
} from "../src/queues/QueueRegistryService.js";

// ANTES de cada test, limpiamos dependencias y aseguramos un reloj real
beforeEach(() => {
  container.clearAll();
  // Re-registramos servicios base después del clearAll para que todos los tests
  // tengan acceso sin depender del orden de importación de módulos
  container.registerClass(CONFIG_SERVICE_TOKEN, DefaultConfigService);
  container.registerClass(QUEUE_REGISTRY_TOKEN, QueueRegistryService);
  vi.useRealTimers();
});

// DESPUÉS de cada test, limpiamos mocks y por doble seguridad restauramos el reloj
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
