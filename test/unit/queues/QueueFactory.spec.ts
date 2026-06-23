import { describe, it, expect, vi, beforeEach } from "vitest";

import { CONFIG_SERVICE_TOKEN } from "../../../src/config/ConfigService.js";
import { DefaultConfigService } from "../../../src/config/DefaultConfigService.js";
import { container } from "../../../src/container/DIContainer.js";
import { DefaultInProcessAdapter } from "../../../src/queues/adapters/DefaultInProcessAdapter.js";
import { LocalWorkerAdapter } from "../../../src/queues/adapters/LocalWorkerAdapter.js";
import { QUEUE_ADAPTER_TOKEN } from "../../../src/queues/interfaces/QueueAdapter.js";
import { getQueueAdapter } from "../../../src/queues/queue.factory.js";

describe("QueueFactory (getQueueAdapter)", () => {
  beforeEach(() => {
    // Restauramos todos los mocks antes de cada test para garantizar aislamiento total
    vi.restoreAllMocks();
    // Evitamos que los logs de error o warning ensucien la salida de los tests
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("Debería registrar e inyectar DefaultInProcessAdapter si no hay configuración explícita", async () => {
    // Creamos un ConfigService real con configuración vacía (sin queue explícito)
    const configService = new DefaultConfigService();
    configService.set("queue", {});

    // Simulamos que no hay ningún adaptador registrado en el contenedor
    // para forzar que la factory decida el default
    vi.spyOn(container, "has").mockReturnValue(false);
    const registerSpy = vi
      .spyOn(container, "registerClass")
      .mockImplementation(() => {});

    // Devolvemos el ConfigService cuando se pida CONFIG_SERVICE_TOKEN,
    // y un dummy adapter cuando se pida QUEUE_ADAPTER_TOKEN
    const dummyInProcess = new DefaultInProcessAdapter();
    vi.spyOn(container, "resolve").mockImplementation((token: unknown) =>
      token === CONFIG_SERVICE_TOKEN ? configService : (dummyInProcess as any),
    );

    // Ejecutamos la factory
    const adapter = await getQueueAdapter();

    // Validamos que tomó la decisión correcta
    expect(registerSpy).toHaveBeenCalledWith(
      QUEUE_ADAPTER_TOKEN,
      DefaultInProcessAdapter,
    );
    expect(adapter).toBe(dummyInProcess);
  });

  it("Debería registrar e inyectar LocalWorkerAdapter si la estrategia es 'worker-pool'", async () => {
    // Creamos un ConfigService con la estrategia worker-pool
    const configService = new DefaultConfigService();
    configService.set("queue", {
      strategy: "worker-pool",
    });

    vi.spyOn(container, "has").mockReturnValue(false);
    const registerSpy = vi
      .spyOn(container, "registerClass")
      .mockImplementation(() => {});

    // Devolvemos un objeto mock en lugar de la clase real para no levantar Hilos en el test
    const dummyWorkerAdapter = { dispatch: vi.fn() };
    vi.spyOn(container, "resolve").mockImplementation((token: unknown) =>
      token === CONFIG_SERVICE_TOKEN
        ? configService
        : (dummyWorkerAdapter as any),
    );

    const adapter = await getQueueAdapter();

    expect(registerSpy).toHaveBeenCalledWith(
      QUEUE_ADAPTER_TOKEN,
      LocalWorkerAdapter,
    );
    expect(adapter).toBe(dummyWorkerAdapter);
  });

  it("No debería registrar nada si ya existe un adaptador en el contenedor (Custom Adapter)", async () => {
    // Simulamos que el usuario inyectó su propio adaptador (ej. RedisQueueAdapter) en su @Module
    vi.spyOn(container, "has").mockImplementation(
      (token) => token === QUEUE_ADAPTER_TOKEN,
    );
    const registerSpy = vi.spyOn(container, "registerClass");

    const customAdapter = { dispatch: vi.fn() };
    vi.spyOn(container, "resolve").mockReturnValue(customAdapter);

    const adapter = await getQueueAdapter();

    // Validamos que la factory respeta el adaptador del usuario y no sobrescribe nada
    expect(registerSpy).not.toHaveBeenCalled();
    expect(adapter).toBe(customAdapter);
  });
});
