import { describe, it, expect } from "vitest";

import {
  UseParams,
  Body,
  Query,
  Param,
  Headers,
  Req,
  Res,
  Ip,
} from "../../../../src/http/decorators/parameters.js";
import type { FastifyKitMetadata } from "../../../../src/http/decorators/types.js";

// Nos aseguramos de que la API de metadata esté disponible para los decoradores.
if (!(Symbol as any).metadata) {
  (Symbol as any).metadata = Symbol.for("Symbol.metadata");
}

describe("Decoradores de Parámetros HTTP (@UseParams)", () => {
  // Mock de un Pipe para pruebas
  class ParseIntPipe {
    transform(value: any) {
      return Number.parseInt(value, 10);
    }
  }

  it("Debería registrar correctamente la metadata de múltiples parámetros en un método", () => {
    class TestController {
      @UseParams(
        Body("name"),
        Query("age", ParseIntPipe),
        Param("id"),
        Headers("x-api-key"),
        Req(),
        Res(),
        Ip(),
      )
      async handleRequest() {
        /* dummy method */
      }
    }

    // Obtenemos la metadata del controlador para validar que los parámetros se guardaron correctamente
    const metadata = (TestController as any)[
      (Symbol as any).metadata
    ] as FastifyKitMetadata;

    // Validamos que se creó la sección de parámetros para el método 'handleRequest'
    expect(metadata.parameters).toBeDefined();
    const params = metadata.parameters?.["handleRequest"];

    // Validamos que se guardaron los 7 parámetros definidos en el decorador @UseParams
    expect(params).toHaveLength(7);

    // Verificación de orden e indexación (es vital para nuestro scanner)
    expect(params![0]).toEqual({
      index: 0,
      type: "body",
      key: "name",
      pipe: undefined,
    });
    expect(params![1]).toEqual({
      index: 1,
      type: "query",
      key: "age",
      pipe: ParseIntPipe,
    });
    expect(params![2]).toEqual({
      index: 2,
      type: "param",
      key: "id",
      pipe: undefined,
    });
    expect(params![3]).toEqual({
      index: 3,
      type: "headers",
      key: "x-api-key",
      pipe: undefined,
    });
    expect(params![4].type).toBe("request");
    expect(params![5].type).toBe("reply");
    expect(params![6].type).toBe("ip");
  });

  it("Debería permitir parámetros sin 'key' para obtener el objeto completo", () => {
    class FullObjectController {
      @UseParams(Body(), Query())
      async update() {
        /* dummy method */
      }
    }

    // Obtenemos la metadata del controlador para validar que los parámetros se guardaron correctamente
    const metadata = (FullObjectController as any)[
      (Symbol as any).metadata
    ] as FastifyKitMetadata;

    // Validamos que se creó la sección de parámetros para el método 'update'
    const params = metadata.parameters?.["update"];

    // Validamos que se guardaron los parámetros sin 'key' y que el tipo es correcto
    expect(params).toHaveLength(2);
    expect(params![0]).toEqual({
      index: 0,
      type: "body",
      key: undefined,
      pipe: undefined,
    });
    expect(params![1]).toEqual({
      index: 1,
      type: "query",
      key: undefined,
      pipe: undefined,
    });
    expect(params![0].key).toBeUndefined();
    expect(params![1].key).toBeUndefined();
  });

  it("Debería manejar múltiples métodos con parámetros independientes en la misma clase", () => {
    class MultiMethodController {
      @UseParams(Param("id"))
      findOne() {
        /* dummy method */
      }

      @UseParams(Body("data"))
      create() {
        /* dummy method */
      }
    }

    // Obtenemos la metadata del controlador para validar que los parámetros se guardaron correctamente
    const metadata = (MultiMethodController as any)[
      (Symbol as any).metadata
    ] as FastifyKitMetadata;

    const paramsFindOne = metadata.parameters?.["findOne"];
    expect(paramsFindOne).toHaveLength(1);
    expect(paramsFindOne![0].index).toBe(0);
    expect(paramsFindOne![0].type).toBe("param");

    const paramsCreate = metadata.parameters?.["create"];
    expect(paramsCreate).toHaveLength(1);
    expect(paramsCreate![0].index).toBe(0);
    expect(paramsCreate![0].type).toBe("body");
  });

  it("Debería lanzar un error si @UseParams se aplica a algo que no es un método", () => {
    expect(() => {
      const decorator = UseParams(Req());
      decorator({}, { kind: "field", name: "prop" } as any);
    }).toThrow();
  });
});
