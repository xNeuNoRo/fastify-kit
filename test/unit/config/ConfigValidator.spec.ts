import { Type } from "@sinclair/typebox";
import { describe, it, expect } from "vitest";

import {
  ConfigValidator,
  ConfigValidationError,
} from "../../../src/config/ConfigValidator.js";

const TestSchema = Type.Object({
  PORT: Type.Number({ default: 3000 }),
  DEBUG: Type.Boolean({ default: false }),
  DATABASE_URL: Type.String(),
  MAX_RETRIES: Type.Number(),
});

describe("ConfigValidator — Validación con TypeBox", () => {
  describe("compile()", () => {
    it("Debería retornar un TypeCompiler válido para un schema TypeBox", () => {
      const compiled = ConfigValidator.compile(TestSchema);
      expect(compiled).toBeDefined();
      expect(typeof compiled.Check).toBe("function");
      expect(typeof compiled.Errors).toBe("function");
    });

    it("Debería permitir compilar schemas anidados", () => {
      const NestedSchema = Type.Object({
        server: Type.Object({
          host: Type.String(),
          port: Type.Number({ default: 8080 }),
        }),
      });
      const compiled = ConfigValidator.compile(NestedSchema);
      expect(compiled).toBeDefined();
    });

    it("Debería permitir compilar schemas con arrays", () => {
      const ArraySchema = Type.Object({
        ALLOWED_ORIGINS: Type.Array(Type.String()),
      });
      const compiled = ConfigValidator.compile(ArraySchema);
      expect(compiled).toBeDefined();
    });
  });

  describe("validate()", () => {
    const compiled = ConfigValidator.compile(TestSchema);

    it("Debería retornar los datos validados si pasan la validación", () => {
      const validData = {
        PORT: 3000,
        DEBUG: false,
        DATABASE_URL: "postgres://localhost",
        MAX_RETRIES: 3,
      };
      const result = ConfigValidator.validate(compiled, validData);
      expect(result).toEqual(validData);
    });

    it("Debería lanzar ConfigValidationError si falta una variable requerida", () => {
      const invalidData = {
        PORT: 3000,
        DEBUG: false,
      };

      expect(() => ConfigValidator.validate(compiled, invalidData)).toThrow(
        ConfigValidationError,
      );
    });

    it("Debería incluir paths precisos en los errores de validación", () => {
      const invalidData = {
        PORT: "abc",
        DEBUG: false,
        DATABASE_URL: "postgres://localhost",
        MAX_RETRIES: 3,
      };

      try {
        ConfigValidator.validate(compiled, invalidData);
        throw new Error("Debería haber lanzado");
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigValidationError);
        const validationErr = err as ConfigValidationError;
        expect(validationErr.errors.length).toBeGreaterThan(0);

        const portError = validationErr.errors.find((e) =>
          e.path.includes("PORT"),
        );
        expect(portError).toBeDefined();
        expect(portError!.message).toBeDefined();
      }
    });

    it("Debería incluir el campo 'value' en los errores", () => {
      const invalidData = {
        PORT: "abc",
        DEBUG: false,
        DATABASE_URL: "postgres://localhost",
        MAX_RETRIES: 3,
      };

      try {
        ConfigValidator.validate(compiled, invalidData);
        throw new Error("Debería haber lanzado");
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigValidationError);
        const validationErr = err as ConfigValidationError;
        const portError = validationErr.errors.find((e) =>
          e.path.includes("PORT"),
        );
        expect(portError).toBeDefined();
        expect(portError!.value).toBeDefined();
      }
    });

    it("Debería rechazar tipos incorrectos (string donde se espera number)", () => {
      const invalidData = {
        PORT: "not-a-number",
        DEBUG: false,
        DATABASE_URL: "postgres://localhost",
        MAX_RETRIES: 3,
      };

      expect(() => ConfigValidator.validate(compiled, invalidData)).toThrow(
        ConfigValidationError,
      );
    });
  });

  describe("coerce()", () => {
    it("Debería coercionar string a number automáticamente", () => {
      const data = {
        PORT: "8080",
        DEBUG: "false",
        DATABASE_URL: "postgres://localhost",
        MAX_RETRIES: "5",
      };
      const coerced = ConfigValidator.coerce(TestSchema, data) as any;
      expect(typeof coerced.PORT).toBe("number");
      expect(coerced.PORT).toBe(8080);
    });

    it("Debería coercionar string a boolean automáticamente", () => {
      const data = {
        PORT: "3000",
        DEBUG: "true",
        DATABASE_URL: "postgres://localhost",
        MAX_RETRIES: "5",
      };
      const coerced = ConfigValidator.coerce(TestSchema, data) as any;
      expect(typeof coerced.DEBUG).toBe("boolean");
      expect(coerced.DEBUG).toBe(true);
    });

    it("Debería coercionar 'false' a false", () => {
      const data = {
        PORT: "3000",
        DEBUG: "false",
        DATABASE_URL: "postgres://localhost",
        MAX_RETRIES: "5",
      };
      const coerced = ConfigValidator.coerce(TestSchema, data) as any;
      expect(coerced.DEBUG).toBe(false);
    });

    it("Debería coercionar string a number en MAX_RETRIES", () => {
      const data = {
        PORT: "3000",
        DEBUG: "false",
        DATABASE_URL: "postgres://localhost",
        MAX_RETRIES: "10",
      };
      const coerced = ConfigValidator.coerce(TestSchema, data) as any;
      expect(typeof coerced.MAX_RETRIES).toBe("number");
      expect(coerced.MAX_RETRIES).toBe(10);
    });

    it("Debería aplicar valores por defecto del schema", () => {
      const data = {
        DATABASE_URL: "postgres://localhost",
        MAX_RETRIES: "5",
      };
      const coerced = ConfigValidator.coerce(TestSchema, data) as any;
      expect(coerced.PORT).toBe(3000);
      expect(coerced.DEBUG).toBe(false);
    });

    it("No debería inventar datos en campos requeridos faltantes", () => {
      const data = {
        PORT: "3000",
        DEBUG: "false",
        DATABASE_URL: "postgres://localhost",
        // MAX_RETRIES falta intencionalmente
      };
      const coerced = ConfigValidator.coerce(TestSchema, data) as any;
      expect(coerced.DATABASE_URL).toBe("postgres://localhost");
      expect(coerced.PORT).toBe(3000);
      expect(coerced.DEBUG).toBe(false);
      // MAX_RETRIES no tiene default, debería ser undefined (no inventado)
      expect(coerced.MAX_RETRIES).toBeUndefined();
    });

    it("Debería preservar valores falsy válidos (0, false, '')", () => {
      const FalsySchema = Type.Object({
        FEATURE_FLAG: Type.Boolean(),
        MAX_RETRIES: Type.Number(),
        PREFIX: Type.String(),
      });
      const data = {
        FEATURE_FLAG: "false",
        MAX_RETRIES: "0",
        PREFIX: "",
      };
      const coerced = ConfigValidator.coerce(FalsySchema, data) as any;
      expect(coerced.FEATURE_FLAG).toBe(false);
      expect(coerced.MAX_RETRIES).toBe(0);
      expect(coerced.PREFIX).toBe("");
    });

    it("Debería mantener string no coercionable como string (no es JSON parser)", () => {
      const data = {
        PORT: '"3000"',
        DEBUG: "false",
        DATABASE_URL: "postgres://localhost",
        MAX_RETRIES: "3",
      };
      const coerced = ConfigValidator.coerce(TestSchema, data) as any;
      // TypeBox Value.Convert no es un JSON parser — mantiene strings con comillas como string
      expect(typeof coerced.PORT).toBe("string");
    });
  });

  describe("findUnknownKeys()", () => {
    it("Debería retornar las claves no declaradas en el schema", () => {
      const data = {
        PORT: 3000,
        DEBUG: false,
        DATABASE_URL: "postgres://localhost",
        EXTRA_KEY: "valor-extra",
        OTRA_CLAVE: "otro-valor",
      };
      const unknown = ConfigValidator.findUnknownKeys(TestSchema, data);
      expect(unknown).toContain("EXTRA_KEY");
      expect(unknown).toContain("OTRA_CLAVE");
      expect(unknown).toHaveLength(2);
    });

    it("Debería retornar [] si todas las claves están en el schema", () => {
      const data = {
        PORT: 3000,
        DEBUG: false,
        DATABASE_URL: "postgres://localhost",
        MAX_RETRIES: 3,
      };
      const unknown = ConfigValidator.findUnknownKeys(TestSchema, data);
      expect(unknown).toEqual([]);
    });

    it("Debería funcionar con schema anidado", () => {
      const NestedSchema = Type.Object({
        SERVER: Type.Object({
          HOST: Type.String(),
          PORT: Type.Number(),
        }),
      });
      const data = {
        SERVER: { HOST: "localhost", PORT: 3000 },
        EXTRA: "extra",
      };
      const unknown = ConfigValidator.findUnknownKeys(NestedSchema, data);
      expect(unknown).toContain("EXTRA");
    });

    it("Debería retornar [] para objeto vacío si schema tiene defaults", () => {
      const OptionalSchema = Type.Object({
        PORT: Type.Number({ default: 3000 }),
      });
      const unknown = ConfigValidator.findUnknownKeys(OptionalSchema, {});
      expect(unknown).toHaveLength(0);
    });
  });

  describe("ConfigValidationError", () => {
    it("Debería tener nombre 'ConfigValidationError'", () => {
      const err = new ConfigValidationError("test", [
        { path: "/key", message: "error" },
      ]);
      expect(err.name).toBe("ConfigValidationError");
    });

    it("Debería almacenar los errores correctamente", () => {
      const errors = [
        { path: "/PORT", message: "Expected number", value: "abc" },
        {
          path: "/DATABASE_URL",
          message: "Expected string",
          value: undefined,
        },
      ];
      const err = new ConfigValidationError("test", errors);
      expect(err.errors).toEqual(errors);
    });

    it("Debería ser instancia de Error", () => {
      const err = new ConfigValidationError("test", []);
      expect(err).toBeInstanceOf(Error);
    });
  });
});
