import { describe, it, expect, vi, beforeEach } from "vitest";

import { LocalWorkerAdapter } from "../../../../src/queues/adapters/LocalWorkerAdapter.js";
import { WorkerPool } from "../../../../src/queues/workers/WorkerPool.js";
import { WorkerLifecycleManager } from "../../../../src/queues/workers/WorkerLifecycleManager.js";

describe("Adaptador Multihilo (LocalWorkerAdapter)", () => {
  let adapter: LocalWorkerAdapter;
  let executeSpy: any;
  let initPoolSpy: any;

  // Antes de cada test, restauramos los mocks para garantizar aislamiento total
  beforeEach(() => {
    vi.restoreAllMocks();

    // Evitamos que los logs de error o warning ensucien la salida de los tests
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // Interceptamos la creación del WorkerPool para evitar levantar hilos reales durante los tests
    initPoolSpy = vi
      .spyOn(WorkerLifecycleManager.prototype as any, "initializePool")
      .mockImplementation(() => {});

    // Interceptamos el método execute para simular su comportamiento sin ejecutar código real en los hilos
    executeSpy = vi
      .spyOn(WorkerPool.prototype, "execute")
      .mockResolvedValue(undefined);

    // Evitamos logs reales durante los tests
    adapter = new LocalWorkerAdapter();
  });

  it("Debería instanciar el WorkerPool internamente sin fallar y sin levantar hilos", () => {
    // Verificamos que realmente creó la instancia
    expect((adapter as any).pool).toBeInstanceOf(WorkerPool);
    // Verificamos que se interceptó la creación de hilos
    expect(initPoolSpy).toHaveBeenCalled();
  });

  it("Debería despachar el trabajo inyectando el _trackingId en el payload y retornar dicho ID", async () => {
    const queueName = "image-processing-queue";
    const payload = { imageId: "123", filter: "sepia" };

    const trackingId = await adapter.dispatch(queueName, payload);

    // Validamos que el método execute del WorkerPool fue llamado con el payload correcto, incluyendo el _trackingId
    expect(typeof trackingId).toBe("string");
    expect(trackingId.length).toBeGreaterThan(0);

    // Validamos que el payload enviado al WorkerPool incluye el _trackingId generado
    expect(executeSpy).toHaveBeenCalledWith(queueName, {
      _trackingId: trackingId,
      ...payload,
    });
  });

  it("Debería capturar el error y loguearlo si el WorkerPool falla (Fire-and-Forget)", async () => {
    const queueName = "faulty-queue";
    const errorToThrow = new Error("El WorkerPool colapsó por memoria");

    // Forzamos al WorkerPool a fallar simulando una promesa rechazada
    executeSpy.mockRejectedValueOnce(errorToThrow);

    // Espiamos el logger para validar que ataja el error
    const loggerErrorSpy = vi
      .spyOn((adapter as any).logger, "error")
      .mockImplementation(() => {});

    // Ejecutamos el dispatch, que debería retornar el trackingId incluso si el WorkerPool falla
    const trackingId = await adapter.dispatch(queueName, {});

    // Forzamos un 'tick' en el Event Loop para que el bloque .catch() termine de ejecutarse
    await new Promise((resolve) => setImmediate(resolve));

    // Validaciones
    expect(typeof trackingId).toBe("string");
    expect(executeSpy).toHaveBeenCalledWith(queueName, {
      _trackingId: trackingId,
    });

    // Comprobamos el logger interno
    expect(loggerErrorSpy).toHaveBeenCalled();
  });
});
