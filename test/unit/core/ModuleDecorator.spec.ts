import { describe, it, expect } from "vitest";

import { Module } from "../../../src/core/module.decorator.js";
import type { FastifyKitMetadata } from "../../../src/http/decorators/types.js";

// Aseguramos que el símbolo para metadata esté definido para poder usarlo en los tests
if (!(Symbol as any).metadata) {
  (Symbol as any).metadata = Symbol.for("Symbol.metadata");
}

describe("Decorador Core (@Module)", () => {
  it("Debería almacenar las opciones del módulo en la metadata de la clase", () => {
    // Definimos clases de prueba para controladores y servicios
    class MockController {
      dummy = true;
    }
    class MockService {
      dummy = true;
    }

    // Mock de opciones para el módulo
    const moduleOptions = {
      controllers: [MockController],
      providers: [MockService],
      imports: [],
      exports: [MockService],
    };

    // Aplicamos el decorador
    @Module(moduleOptions)
    class TestModule {}

    // Extraemos la metadata
    const metadata = (TestModule as any)[
      (Symbol as any).metadata
    ] as FastifyKitMetadata;

    // Verificamos que las opciones se guardaron correctamente para que el Scanner las lea
    expect(metadata).toBeDefined();
    expect(metadata.moduleOptions).toBeDefined();
    expect(metadata.moduleOptions).toEqual(moduleOptions);
    expect(metadata.moduleOptions?.controllers).toContain(MockController);
    expect(metadata.moduleOptions?.providers).toContain(MockService);
    expect(metadata.moduleOptions?.exports).toContain(MockService);
  });

  it("Debería lanzar un error si se aplica a algo que no es una clase (ej: un método)", () => {
    expect(() => {
      // Intentamos aplicar el decorador manualmente a un contexto de método
      const decorator = Module({ controllers: [] });
      decorator(
        class {
          dummy = true;
        },
        { kind: "method", name: "badMethod" } as any,
      );
    }).toThrow("@Module solo puede aplicarse a clases.");
  });
});
