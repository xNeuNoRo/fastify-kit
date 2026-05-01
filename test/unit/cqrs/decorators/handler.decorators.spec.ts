import { describe, it, expect, beforeEach } from "vitest";

import { container } from "../../../../src/container/DIContainer.js";
import {
  CommandHandler,
  QueryHandler,
} from "../../../../src/cqrs/decorators/handler.decorators.js";
import { getCqrsHandlerToken } from "../../../../src/cqrs/utils/cqrs-token.util.js";
import type { FastifyKitMetadata } from "../../../../src/http/decorators/types.js";

// Clases Mock para las pruebas
class CreateUserCommand {
  dummy = true;
}
class GetUserQuery {
  dummy = false;
}

describe("CQRS Decorators", () => {
  // Limpiamos el contenedor antes de cada prueba para evitar colisiones
  beforeEach(() => {
    container.clearAll();
  });

  describe("Decorador @CommandHandler", () => {
    it("Debería registrar el handler en el DIContainer y añadir metadata estricta", () => {
      const metadataMock = {} as FastifyKitMetadata;
      const token = getCqrsHandlerToken(CreateUserCommand);

      // Creamos un contexto mockeado
      const contextMock: ClassDecoratorContext = {
        kind: "class",
        name: "CreateUserHandler",
        metadata: metadataMock,
      } as any;

      // Simulamos la clase que será decorada
      class CreateUserHandler {
        dummy = "handler";
      }

      // Ejecutamos el decorador
      const decoratorFactory = CommandHandler(CreateUserCommand);
      decoratorFactory(CreateUserHandler, contextMock);

      // Verificamos que la metadata se inyectó correctamente
      expect(metadataMock.cqrsHandler).toBe(true);

      // Verificamos que el handler se registró en el DIContainer
      expect(container.has(token)).toBe(true);

      // Verificamos que resuelve la implementación correcta
      const resolvedInstance = container.resolve(token);
      expect(resolvedInstance).toBeInstanceOf(CreateUserHandler);
    });

    it("Debería lanzar error si no se usa en una clase", () => {
      const contextMock: any = { kind: "method" }; // Simulamos un decorador de método

      const decoratorFactory = CommandHandler(CreateUserCommand);

      expect(() =>
        decoratorFactory(
          class {
            dummy = "not a class";
          },
          contextMock,
        ),
      ).toThrow();
    });
  });

  describe("Decorador @QueryHandler", () => {
    it("Debería registrar el handler de Query en el DIContainer y añadir metadata estricta", () => {
      const metadataMock = {} as FastifyKitMetadata;
      const token = getCqrsHandlerToken(GetUserQuery);

      const contextMock: ClassDecoratorContext = {
        kind: "class",
        name: "GetUserHandler",
        metadata: metadataMock,
      } as any;

      class GetUserHandler {
        dummy = "query handler";
      }

      const decoratorFactory = QueryHandler(GetUserQuery);
      decoratorFactory(GetUserHandler, contextMock);

      expect(metadataMock.cqrsHandler).toBe(true);
      expect(container.has(token)).toBe(true);

      const resolvedInstance = container.resolve(token);
      expect(resolvedInstance).toBeInstanceOf(GetUserHandler);
    });
  });
});
