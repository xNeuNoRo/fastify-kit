import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { container } from "../../../../src/container/DIContainer.js";
import { DefaultInProcessAdapter } from "../../../../src/queues/adapters/DefaultInProcessAdapter.js";
import {
  QueueRegistryService,
  QUEUE_REGISTRY_TOKEN,
} from "../../../../src/queues/QueueRegistryService.js";

describe("Adaptador por defecto para colas en proceso (DefaultInProcessAdapter)", () => {
  let adapter: DefaultInProcessAdapter;
  let registry: QueueRegistryService;

  beforeEach(async () => {
    // Drenamos tareas pendientes de setImmediate de tests anteriores
    await new Promise((resolve) => setImmediate(resolve));
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    registry = new QueueRegistryService();
    container.registerInstance(QUEUE_REGISTRY_TOKEN, registry);
    adapter = new DefaultInProcessAdapter();
  });

  afterEach(() => {
    container.clearAll();
  });

  it("Debería retornar un tracking ID (UUID) inmediatamente sin bloquear la ejecución", async () => {
    const queueName = "fast-queue";
    const payload = { data: 123 };

    const _trackingId = await adapter.dispatch(queueName, payload);

    expect(typeof _trackingId).toBe("string");
    expect(_trackingId.length).toBeGreaterThan(0);
  });

  it("Debería ejecutar la tarea asíncronamente llamando a la clase correcta", async () => {
    const queueName = "email-queue";
    const payload = { to: "user@test.com" };

    class DummyEmailProcessor {
      dummy = true;
    }

    const handleSpy = vi.fn().mockResolvedValue(true);
    const mockInstance = { handle: handleSpy };

    registry.register(queueName, DummyEmailProcessor, "io");
    container.registerInstance(DummyEmailProcessor, mockInstance);

    const __trackingId = await adapter.dispatch(queueName, payload);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(handleSpy).toHaveBeenCalledWith(expect.any(String), payload);
  });

  it("Debería loguear un error si no hay procesador registrado y lanzar desde dentro del setImmediate", async () => {
    const queueName = "ghost-queue";
    const payload = { ghost: true };

    const _trackingId = await adapter.dispatch(queueName, payload);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(console.error).toHaveBeenCalled();
  });

  it("Debería capturar y loguear el error si el procesador falla", async () => {
    const queueName = "failing-queue";
    const payload = { explode: true };

    class FaultyProcessor {
      dummy = true;
    }

    const handleSpy = vi.fn().mockRejectedValue(new Error("BOOM"));
    const mockInstance = { handle: handleSpy };

    registry.register(queueName, FaultyProcessor, "io");
    container.registerInstance(FaultyProcessor, mockInstance);

    const _trackingId = await adapter.dispatch(queueName, payload);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(console.error).toHaveBeenCalled();
  });
});
