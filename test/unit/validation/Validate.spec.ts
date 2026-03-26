import { Type } from "@sinclair/typebox";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";

import { container } from "../../../src/container/DIContainer.js";
import { ValidationException } from "../../../src/http/exceptions/index.js";
import { getLogger } from "../../../src/logger/logger.factory.js";
import {
  DefaultConsoleLogger,
  LOGGER_TOKEN,
} from "../../../src/logger/LoggerContract.js";
import { Validate } from "../../../src/validation/validate.decorator.js";

const UserSchema = Type.Object({
  name: Type.String(),
  age: Type.Number({ minimum: 18 }),
});
const EmailSchema = Type.String({ minLength: 5 });

describe("Sistema de Validación (@Validate & TypeBox)", () => {
  let loggerWarnSpy: MockInstance;
  let loggerErrorSpy: MockInstance;

  beforeEach(() => {
    container.registerInstance(LOGGER_TOKEN, new DefaultConsoleLogger());
    // Mockeamos los métodos del logger para evitar salidas reales durante las pruebas
    const logger = getLogger();
    loggerWarnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    loggerErrorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Validaciones Exitosas", () => {
    it("Deberia permitir la ejecución del método si los datos cumplen el esquema", () => {
      class UserController {
        public executed = false;

        @Validate(UserSchema)
        createUser(data: any) {
          this.executed = true;
          return { success: true, user: data };
        }
      }

      const controller = new UserController();
      const validData = { name: "Angel", age: 25 };

      const result = controller.createUser(validData);

      expect(controller.executed).toBe(true);
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.user).toEqual(validData);
      expect(loggerWarnSpy).not.toHaveBeenCalled();
    });

    it("Debería validar correctamente un argumento en un índice específico (argIndex > 0)", () => {
      class NotificationService {
        @Validate(EmailSchema, 1) // Validamos el SEGUNDO argumento (email)
        sendEmail(userId: number, email: any) {
          return `Email sent to ${email}`;
        }
      }

      const service = new NotificationService();

      // El validador pasaría ya que el email cumple con el esquema (string.length >= 5)
      const result = service.sendEmail(123, "test@fastifykit.com");

      expect(result).toBe("Email sent to test@fastifykit.com");
    });
  });

  describe("Rechazo de Datos y Excepciones", () => {
    it("Debería lanzar ValidationException y registrar un warning si los datos son inválidos", () => {
      class UserController {
        @Validate(UserSchema)
        createUser(data: any) {
          return `Esto nunca debería ejecutarse ${data.name}`;
        }
      }

      const controller = new UserController();
      // El esquema exige 'age' como Number >= 18
      const invalidData = { name: "Junior", age: 15 };

      // Validamos que lance exactamente tu excepción de negocio
      expect(() => controller.createUser(invalidData)).toThrow(
        ValidationException,
      );

      try {
        controller.createUser(invalidData);
      } catch (error: any) {
        // Validamos la estructura interna de la excepción y los errores de TypeBox
        expect(error).toBeDefined();
        expect(error).toBeInstanceOf(ValidationException);
        expect(error.details).toBeDefined();
        expect(Array.isArray(error.details)).toBe(true);
        expect(error.details[0].path).toBe("/age");
        expect(error.details[0].value).toBe(15);
      }

      // Validamos que el logger haya emitido el Warning de seguridad
      expect(loggerWarnSpy).toHaveBeenCalledTimes(2); // (1 por el expect toThrow, 1 por el try/catch)
    });

    it("Debería lanzar un Error genérico y registrar un error crítico si el argumento es undefined", () => {
      class ProductController {
        @Validate(Type.String())
        updateProduct(id?: string) {
          return `Never should execute ${id}`;
        }
      }

      const controller = new ProductController();

      // No le pasamos ningún argumento
      expect(() => controller.updateProduct()).toThrow();

      // Validamos se haya registrado un error en el logger
      expect(loggerErrorSpy).toHaveBeenCalled();
    });
  });

  describe("Protección del Decorador", () => {
    it("Debería lanzar un error si @Validate se aplica a algo que no es un método", () => {
      expect(() => {
        class InvalidUsage {
          declare public dummy: unknown;
          constructor() {
            const validateFn = Validate(Type.String());
            validateFn(undefined as any, { kind: "field", name: "bad" } as any);
          }
        }
        new InvalidUsage();
      }).toThrow();
    });
  });
});
