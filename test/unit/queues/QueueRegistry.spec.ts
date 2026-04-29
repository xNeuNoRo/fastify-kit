import { describe, it, expect } from "vitest";

import { QueueRegistry } from "../../../src/queues/QueueRegistry.js";

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

describe("QueueRegistry (Memoria Estática)", () => {
  it("Debería registrar un procesador correctamente y recuperar su clase y tipo", () => {
    const queueName = "test-email-queue";

    // Registramos la cola
    QueueRegistry.register(queueName, DummyEmailProcessor, "io");

    // Validamos la recuperación de la clase
    const ProcessorClass = QueueRegistry.getProcessor(queueName);
    expect(ProcessorClass).toBeDefined();
    expect(ProcessorClass).toBe(DummyEmailProcessor);

    // Validamos la recuperación del tipo de carga
    const queueType = QueueRegistry.getQueueType(queueName);
    expect(queueType).toBe("io");
  });

  it("Debería listar correctamente todas las colas registradas", () => {
    const queueName1 = "list-queue-1";
    const queueName2 = "list-queue-2";

    QueueRegistry.register(queueName1, DummyEmailProcessor, "cpu");
    QueueRegistry.register(queueName2, DummyVideoProcessor, "cpu");

    const queues = QueueRegistry.getRegisteredQueues();

    expect(Array.isArray(queues)).toBe(true);
    expect(queues).toContain(queueName1);
    expect(queues).toContain(queueName2);
  });

  it("Debería lanzar un error si se intenta registrar una cola duplicada (Colisión)", () => {
    const collisionQueueName = "collision-queue";

    // Primer registro exitoso
    QueueRegistry.register(collisionQueueName, DummyEmailProcessor, "io");

    // Segundo registro con el mismo nombre debe fallar
    expect(() => {
      QueueRegistry.register(collisionQueueName, DummyVideoProcessor, "cpu");
    }).toThrow();
  });

  it("Debería retornar undefined si se consulta una cola inexistente", () => {
    const ghostQueueName = "ghost-queue-does-not-exist";

    expect(QueueRegistry.getProcessor(ghostQueueName)).toBeUndefined();
    expect(QueueRegistry.getQueueType(ghostQueueName)).toBeUndefined();
  });
});
