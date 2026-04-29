import { describe, it, expect, vi, beforeEach } from "vitest";

import { ConfigRegistry } from "../../../src/config/ConfigRegistry.js";
import { container } from "../../../src/container/DIContainer.js";
import { DefaultInProcessAdapter } from "../../../src/queues/adapters/DefaultInProcessAdapter.js";
import { LocalWorkerAdapter } from "../../../src/queues/adapters/LocalWorkerAdapter.js";
import { QUEUE_ADAPTER_TOKEN } from "../../../src/queues/interfaces/QueueAdapter.js";
import { getQueueAdapter } from "../../../src/queues/queue.factory.js";

describe("QueueFactory (getQueueAdapter)", () => {
  beforeEach(() => {
    // Restauramos todos los mocks antes de cada test para garantizar aislamiento total
    vi.restoreAllMocks();
  });

  it("Debería registrar e inyectar DefaultInProcessAdapter si no hay configuración explícita", () => {
    // Simulamos que el usuario no pasó configuración o pasó un objeto vacío
    const getSpy = vi.spyOn(ConfigRegistry, "get").mockReturnValue({});

    // Simulamos que no hay ningún adaptador registrado en el contenedor
    // para forzar que la factory decida el default
    vi.spyOn(container, "has").mockReturnValue(false);
    const registerSpy = vi
      .spyOn(container, "registerClass")
      .mockImplementation(() => {});

    // Devolvemos una instancia dummy simulando que el resolve funcionó
    const dummyInProcess = new DefaultInProcessAdapter();
    vi.spyOn(container, "resolve").mockReturnValue(dummyInProcess);

    // Ejecutamos la factory
    const adapter = getQueueAdapter();

    // Validamos que tomó la decisión correcta
    expect(getSpy).toHaveBeenCalledWith("queue_user_config");
    expect(registerSpy).toHaveBeenCalledWith(
      QUEUE_ADAPTER_TOKEN,
      DefaultInProcessAdapter,
    );
    expect(adapter).toBe(dummyInProcess);
  });

  it("Debería registrar e inyectar LocalWorkerAdapter si la estrategia es 'worker-pool'", () => {
    // Simulamos que el usuario pidió explícitamente el motor multihilo
    vi.spyOn(ConfigRegistry, "get").mockReturnValue({
      strategy: "worker-pool",
    });

    vi.spyOn(container, "has").mockReturnValue(false);
    const registerSpy = vi
      .spyOn(container, "registerClass")
      .mockImplementation(() => {});

    // Devolvemos un objeto mock en lugar de la clase real para no levantar Hilos en el test
    const dummyWorkerAdapter = { dispatch: vi.fn() };
    vi.spyOn(container, "resolve").mockReturnValue(dummyWorkerAdapter);

    const adapter = getQueueAdapter();

    expect(registerSpy).toHaveBeenCalledWith(
      QUEUE_ADAPTER_TOKEN,
      LocalWorkerAdapter,
    );
    expect(adapter).toBe(dummyWorkerAdapter);
  });

  it("No debería registrar nada si ya existe un adaptador en el contenedor (Custom Adapter)", () => {
    // Simulamos que el usuario inyectó su propio adaptador (ej. RedisQueueAdapter) en su @Module
    vi.spyOn(container, "has").mockImplementation(
      (token) => token === QUEUE_ADAPTER_TOKEN,
    );
    const registerSpy = vi.spyOn(container, "registerClass");

    const customAdapter = { dispatch: vi.fn() };
    vi.spyOn(container, "resolve").mockReturnValue(customAdapter);

    const adapter = getQueueAdapter();

    // Validamos que la factory respeta el adaptador del usuario y no sobrescribe nada
    expect(registerSpy).not.toHaveBeenCalled();
    expect(adapter).toBe(customAdapter);
  });
});
