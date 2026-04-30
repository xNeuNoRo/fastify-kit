import { describe, it, expect, vi, beforeEach } from "vitest";

import { container } from "../../../../src/container/DIContainer.js";
import { DefaultInProcessAdapter } from "../../../../src/queues/adapters/DefaultInProcessAdapter.js";
import { QueueRegistry } from "../../../../src/queues/QueueRegistry.js";

describe("Adaptador por defecto para colas en proceso (DefaultInProcessAdapter)", () => {
  let adapter: DefaultInProcessAdapter;

  // Antes de cada test, restauramos los mocks para garantizar aislamiento total
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {}); // Evitamos logs de error en la salida de los tests
    vi.spyOn(console, "warn").mockImplementation(() => {}); // Evitamos logs de warning en la salida de los tests
    adapter = new DefaultInProcessAdapter();
  });

  it("Debería retornar un tracking ID (UUID) inmediatamente sin bloquear la ejecución", async () => {
    const queueName = "fast-queue";
    const payload = { data: 123 };

    vi.spyOn(QueueRegistry, "getProcessor").mockReturnValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const trackingId = await adapter.dispatch(queueName, payload);

    expect(typeof trackingId).toBe("string");
    expect(trackingId.length).toBeGreaterThan(0);
  });

  it("Debería ejecutar la tarea asíncronamente llamando a la clase correcta", async () => {
    const queueName = "email-queue";
    const payload = { to: "user@test.com" };

    class DummyEmailProcessor {
      dummy = true;
    }

    const handleSpy = vi.fn().mockResolvedValue(true);
    const mockInstance = { handle: handleSpy };

    const getProcessorSpy = vi
      .spyOn(QueueRegistry, "getProcessor")
      .mockReturnValue(DummyEmailProcessor);
    const resolveSpy = vi
      .spyOn(container, "resolve")
      .mockReturnValue(mockInstance);

    const trackingId = await adapter.dispatch(queueName, payload);

    await new Promise((resolve) => setImmediate(resolve));

    expect(getProcessorSpy).toHaveBeenCalledWith(queueName);
    expect(resolveSpy).toHaveBeenCalledWith(DummyEmailProcessor);
    expect(handleSpy).toHaveBeenCalledWith(trackingId, payload);
  });

  it("Debería capturar y loguear el error si no hay un procesador registrado para la cola", async () => {
    const queueName = "unregistered-queue";

    vi.spyOn(QueueRegistry, "getProcessor").mockReturnValue(undefined);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await adapter.dispatch(queueName, {});

    await new Promise((resolve) => setImmediate(resolve));

    expect(consoleSpy).toHaveBeenCalled();
  });

  it("Debería capturar y loguear el error si el procesador lanza una excepción durante su ejecución", async () => {
    const queueName = "error-queue";
    class FaultyProcessor {
      faulty = true;
    }

    const errorToThrow = new Error("Fallo interno en el procesador");
    const handleSpy = vi.fn().mockRejectedValue(errorToThrow);

    vi.spyOn(QueueRegistry, "getProcessor").mockReturnValue(FaultyProcessor);
    vi.spyOn(container, "resolve").mockReturnValue({ handle: handleSpy });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await adapter.dispatch(queueName, {});

    await new Promise((resolve) => setImmediate(resolve));

    expect(handleSpy).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
  });
});
