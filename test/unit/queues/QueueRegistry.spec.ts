import { describe, it, expect, beforeEach } from "vitest";

import { container } from "../../../src/container/DIContainer.js";
import { QueueRegistryService } from "../../../src/queues/QueueRegistryService.js";
import { QUEUE_REGISTRY_TOKEN } from "../../../src/queues/QueueRegistryService.js";

// Clases dummy para simular los procesadores que inyectaría el usuario
class DummyEmailProcessor {
  async handle() {
    await Promise.resolve(); // Simulamos una tarea asíncrona
    return true;
  }
}

class DummyVideoProcessor {
  async handle() {
    await Promise.resolve(); // Simulamos una tarea asíncrona
    return true;
  }
}

describe("QueueRegistryService (Inyectable)", () => {
  let registry: QueueRegistryService;

  beforeEach(() => {
    // Registramos el servicio en el contenedor para cada test
    container.registerClass(QUEUE_REGISTRY_TOKEN, QueueRegistryService);
    registry = container.resolve(QUEUE_REGISTRY_TOKEN);
  });

  it("Debería registrar un procesador correctamente y recuperar su clase y tipo", () => {
    const queueName = "test-email-queue";

    // Registramos la cola
    registry.register(queueName, DummyEmailProcessor, "io");

    // Validamos la recuperación de la clase
    const ProcessorClass = registry.getProcessor(queueName);
    expect(ProcessorClass).toBeDefined();
    expect(ProcessorClass).toBe(DummyEmailProcessor);

    // Validamos la recuperación del tipo de carga
    const queueType = registry.getQueueType(queueName);
    expect(queueType).toBe("io");
  });

  it("Debería listar correctamente todas las colas registradas", () => {
    const queueName1 = "list-queue-1";
    const queueName2 = "list-queue-2";

    registry.register(queueName1, DummyEmailProcessor, "cpu");
    registry.register(queueName2, DummyVideoProcessor, "cpu");

    const queues = registry.getRegisteredQueues();

    expect(Array.isArray(queues)).toBe(true);
    expect(queues).toContain(queueName1);
    expect(queues).toContain(queueName2);
  });

  it("Debería lanzar un error si se intenta registrar una cola duplicada (Colisión)", () => {
    const collisionQueueName = "collision-queue";

    // Primer registro exitoso
    registry.register(collisionQueueName, DummyEmailProcessor, "io");

    // Segundo registro con el mismo nombre debe fallar
    expect(() => {
      registry.register(collisionQueueName, DummyVideoProcessor, "cpu");
    }).toThrow();
  });

  it("Debería retornar undefined si se consulta una cola inexistente", () => {
    const ghostQueueName = "ghost-queue-does-not-exist";

    expect(registry.getProcessor(ghostQueueName)).toBeUndefined();
    expect(registry.getQueueType(ghostQueueName)).toBeUndefined();
  });
});
