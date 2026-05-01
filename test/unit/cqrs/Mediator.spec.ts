import { describe, it, expect, beforeEach, vi } from "vitest";

import { container } from "../../../src/container/DIContainer.js";
import type {
  IRequest,
  IRequestHandler,
} from "../../../src/cqrs/interfaces/request.interface.js";
import { Mediator } from "../../../src/cqrs/Mediator.js";
import { getCqrsHandlerToken } from "../../../src/cqrs/utils/cqrs-token.util.js";

// Clases Mock para las pruebas
class TestCommand implements IRequest<string> {
  readonly _resultType?: string;
  constructor(public readonly payload: string) {}
}

class UnregisteredCommand implements IRequest<void> {
  readonly _resultType?: void;
}

class TestCommandHandler implements IRequestHandler<TestCommand, string> {
  public async handle(request: TestCommand): Promise<string> {
    await Promise.resolve(); // Simulamos una operación async
    return `Success: ${request.payload}`;
  }
}

describe("Clase Mediator", () => {
  let mediator: Mediator;

  // Limpiamos e instanciamos antes de cada test
  beforeEach(() => {
    container.clearAll();
    mediator = new Mediator();
  });

  it("Debería resolver el handler desde el DIContainer y ejecutarlo", async () => {
    const token = getCqrsHandlerToken(TestCommand);
    const mockHandler = new TestCommandHandler();

    // Espiamos el método handle para saber si el Mediator realmente lo llama
    const handleSpy = vi.spyOn(mockHandler, "handle");

    // Registramos la instancia manualmente en el contenedor simulando lo que haría el framework
    container.registerInstance(token, mockHandler);

    const command = new TestCommand("CQRS is awesome");
    const result = await mediator.send(command);

    expect(result).toBe("Success: CQRS is awesome");
    expect(handleSpy).toHaveBeenCalledOnce();
    expect(handleSpy).toHaveBeenCalledWith(command);
  });

  it("Debería lanzar un error si se envía un comando sin handler registrado", async () => {
    const command = new UnregisteredCommand();

    await expect(mediator.send(command)).rejects.toThrow();
  });
});
