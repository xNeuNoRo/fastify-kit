import { Type } from "@sinclair/typebox";
import { describe, it, expect } from "vitest";

import { Controller } from "../../../../src/http/decorators/controller.js";
import { Get } from "../../../../src/http/decorators/methods.js";
import { Serialize } from "../../../../src/http/decorators/serialize.js";
import type { FastifyKitMetadata } from "../../../../src/http/decorators/types.js";

// Aseguramos que Symbol.metadata esté definido para almacenar la metadata de los decoradores
if (!(Symbol as any).metadata) {
  (Symbol as any).metadata = Symbol.for("Symbol.metadata");
}

describe("Decorador @Serialize", () => {
  it("Debería agregar el esquema de TypeBox envuelto a la metadata de la ruta", () => {
    // Simulamos un esquema de TypeBox para la respuesta
    const DummySchema = Type.Object({
      id: Type.Number(),
      name: Type.String(),
    });

    // Creamos un controlador dummy para probar el decorador
    @Controller("/test")
    class TestController {
      @Get("/data")
      @Serialize(DummySchema, 201) // Le pasamos el código 201 para probar
      getData() {
        return { id: 1, name: "Angel", secreto: "123" };
      }
    }

    // Extraemos la metadata generada por los decoradores
    const metadata = (TestController as any)[
      (Symbol as any).metadata
    ] as FastifyKitMetadata;
    const route = metadata.routes?.find((r) => r.handlerName === "getData");

    // Validamos que la ruta y las respuestas estén definidas
    expect(route).toBeDefined();
    expect(metadata.responsesSchema).toBeDefined();
    expect(metadata.responsesSchema?.["getData"]?.[201]).toBeDefined();

    // Validamos que el esquema de respuesta esté envuelto correctamente
    // Debería tener propiedades como 'ok', 'data', 'error', etc.
    const wrappedSchema = metadata.responsesSchema?.["getData"]?.[201] as any;
    expect(wrappedSchema.type).toBe("object");
    expect(wrappedSchema.properties).toHaveProperty("ok");
    expect(wrappedSchema.properties).toHaveProperty("data");
    expect(wrappedSchema.properties).toHaveProperty("error");
    expect(wrappedSchema.properties).toHaveProperty("timestamp");
  });
});
