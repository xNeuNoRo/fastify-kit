import { describe, it, expect } from "vitest";

import type { FastifyKitMetadata } from "../../../src/http/decorators/types.js";
import { Processor } from "../../../src/queues/decorators/processor.js";

// Aseguramos que Symbol.metadata esté definido
if (!(Symbol as any).metadata) {
  (Symbol as any).metadata = Symbol.for("Symbol.metadata");
}

describe("Decorador @Processor (Inyección de Metadatos)", () => {
  it("Debería registrar la metadata de la cola con el tipo 'cpu' por defecto", () => {
    const fakeMetadata: any = {};

    // Instanciamos el decorador como función
    const decorator = Processor("test-default-queue");

    // Lo ejecutamos simulando el ClassDecoratorContext
    decorator(
      class Dummy {
        DummyMethod() {
          // Clase dummy
        }
      } as any,
      {
        kind: "class",
        name: "Dummy",
        metadata: fakeMetadata,
      } as any,
    );

    const metadata = fakeMetadata as FastifyKitMetadata;

    expect(metadata).toBeDefined();
    expect(metadata.queue).toBeDefined();
    expect(metadata.queue?.name).toBe("test-default-queue");
    expect(metadata.queue?.type).toBe("cpu"); // Validamos el default
  });

  it("Debería registrar la metadata de la cola con el tipo 'io' cuando se especifica explícitamente", () => {
    const fakeMetadata: any = {};

    const decorator = Processor("test-io-queue", "io");

    decorator(
      class DummyIo {
        DummyMethod() {
          // Clase dummy
        }
      } as any,
      {
        kind: "class",
        name: "DummyIo",
        metadata: fakeMetadata,
      } as any,
    );

    const metadata = fakeMetadata as FastifyKitMetadata;

    expect(metadata).toBeDefined();
    expect(metadata.queue).toBeDefined();
    expect(metadata.queue?.name).toBe("test-io-queue");
    expect(metadata.queue?.type).toBe("io"); // Validamos que respeta el parámetro
  });

  it("No debería sobrescribir otra metadata existente en la clase", () => {
    // Simulamos un obj de metadata que ya tiene configuraciones
    const fakeMetadata: any = {
      test: true,
    };

    const decorator = Processor("mixed-queue");

    decorator(
      class DummyMixed {
        DummyMethod() {
          // Clase dummy
        }
      } as any,
      {
        kind: "class",
        name: "DummyMixed",
        metadata: fakeMetadata,
      } as any,
    );

    // El objeto original no debería haberse sobrescrito, sino fusionado
    expect(fakeMetadata.test).toBe(true);
    expect(fakeMetadata.queue).toBeDefined();
    expect(fakeMetadata.queue.name).toBe("mixed-queue");
  });

  describe("Protección del Decorador", () => {
    it("Debería lanzar un error si @Processor se aplica a algo que no es una clase (ej. un método)", () => {
      expect(() => {
        const invalidDecorator = Processor("invalid-queue");

        // Simulamos aplicarlo a un método (kind: "method")
        invalidDecorator(
          (() => {}) as any,
          {
            kind: "method",
            name: "badMethod",
            metadata: {}, // Añadimos metadata para emular un contexto real
          } as any,
        );
      }).toThrow();
    });
  });
});
