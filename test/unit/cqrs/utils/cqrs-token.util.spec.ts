import { describe, it, expect } from "vitest";

import { getCqrsHandlerToken } from "../../../../src/cqrs/utils/cqrs-token.util.js";

// Clases Mock para las pruebas
class MockCommand {
  dummy = true;
}
class AnotherMockCommand {
  dummy = false;
}

describe("CQRS Token Utility (getCqrsHandlerToken)", () => {
  it("Debería generar un Symbol con el prefijo correcto basado en el nombre de la clase", () => {
    const token = getCqrsHandlerToken(MockCommand);

    // Verificamos que es un Symbol
    expect(typeof token).toBe("symbol");

    // Verificamos que la descripción del Symbol es la correcta
    expect(token.description).toBe("CQRS_HANDLER_MockCommand");
  });

  it("Debería devolver exactamente el mismo Symbol (idempotencia) para la misma clase", () => {
    const token1 = getCqrsHandlerToken(MockCommand);
    const token2 = getCqrsHandlerToken(MockCommand);
    const tokenOther = getCqrsHandlerToken(AnotherMockCommand);

    // Deben ser el mismo espacio en memoria gracias a Symbol.for()
    expect(token1).toBe(token2);

    // Deben ser diferentes si la clase es diferente
    expect(token1).not.toBe(tokenOther);
  });

  it("Debería arrojar un error si se pasa un constructor inválido o sin nombre", () => {
    // Probamos con undefined
    expect(() => getCqrsHandlerToken(undefined as any)).toThrow();

    // Probamos con un objeto anónimo sin construct.name
    expect(() => getCqrsHandlerToken({} as any)).toThrow();
  });
});
