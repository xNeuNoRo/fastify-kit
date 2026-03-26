import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { container } from "../../../../src/container/DIContainer.js";
import { Controller } from "../../../../src/http/decorators/controller.js";
import {
  Get,
  Post,
  Put,
  Patch,
  Delete,
} from "../../../../src/http/decorators/methods.js";
import type { FastifyKitMetadata } from "../../../../src/http/decorators/types.js";

// Nos aseguramos de que la API de metadata esté disponible para los decoradores.
if (!(Symbol as any).metadata) {
  (Symbol as any).metadata = Symbol.for("Symbol.metadata");
}

describe("Decoradores HTTP de Enrutamiento", () => {
  beforeEach(() => {
    // Espiamos el contenedor para validar que @Controller registra la clase,
    // pero evitamos que realmente la registre para no ensuciar otros tests.
    vi.spyOn(container, "registerClass").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("@Controller Decorator", () => {
    it("Debería registrar la clase en el contenedor y guardar el prefijo en la metadata", () => {
      @Controller("/api/users")
      class UserController {}

      // Obtenemos la metadata del controlador
      const metadata = (UserController as any)[
        (Symbol as any).metadata
      ] as FastifyKitMetadata;

      // Confirmamos que efectivamente se creó la metadata y se guardó el prefijo correctamente
      expect(metadata).toBeDefined();
      expect(metadata.prefix).toBe("/api/users");

      // Validamos que se inyectó al contenedor
      expect((container.registerClass as any).mock.calls).toHaveLength(1);
      expect((container.registerClass as any).mock.calls[0]).toEqual([
        UserController, // Esto seria el contrato, pero como es una clase concreta, se usa la misma referencia como implementación
        UserController, // Implementacion concreta
      ]);
    });

    it("Debería normalizar el prefijo eliminando la barra final (trailing slash)", () => {
      @Controller("/api/v1/")
      class ApiController {}

      const metadata = (ApiController as any)[
        (Symbol as any).metadata
      ] as FastifyKitMetadata;

      // La barra final debe desaparecer
      expect(metadata.prefix).toBe("/api/v1");
    });

    it("Debería permitir un prefijo vacío por defecto", () => {
      @Controller()
      class RootController {}

      const metadata = (RootController as any)[
        (Symbol as any).metadata
      ] as FastifyKitMetadata;

      // El prefijo debe ser una cadena vacía si no se proporciona ningún argumento
      expect(metadata.prefix).toBe("");
    });

    it("Debería lanzar error si @Controller se aplica a algo que no es una clase", () => {
      expect(() => {
        const controllerFn = Controller("/test");
        controllerFn(
          class {
            /* dummy class */
            dummy = true;
          },
          { kind: "method", name: "bad" } as any,
        );
      }).toThrow();
    });
  });

  describe("Decoradores de Métodos HTTP (@Get, @Post, etc.)", () => {
    it("Deberían agregar las rutas al array 'routes' en la metadata de la clase", () => {
      // Inventamos un esquema de validación dummy para probar que se guarda correctamente en la metadata del método
      const mockSchema = { body: { type: "object" } };

      class ProductController {
        @Get()
        getAll() {
          /* dummy method */
        }

        @Post("/create", mockSchema)
        createProduct() {
          /* dummy method */
        }

        @Put("/:id")
        update() {
          /* dummy method */
        }

        @Patch("/:id/status")
        patchStatus() {
          /* dummy method */
        }

        @Delete("/:id")
        remove() {
          /* dummy method */
        }
      }

      // Obtenemos la metadata del controlador para validar que las rutas se guardaron correctamente
      const metadata = (ProductController as any)[
        (Symbol as any).metadata
      ] as FastifyKitMetadata;

      // Validamos que se creó el array de rutas y que tiene la cantidad correcta de entradas
      expect(metadata.routes).toBeDefined();
      expect(metadata.routes).toHaveLength(5);

      // Validamos el @Get (sin path ni esquema explícito)
      expect(metadata.routes![0]).toEqual({
        method: "get",
        path: "",
        handlerName: "getAll",
        schema: undefined,
      });

      // Validamos el @Post (con path y esquema)
      expect(metadata.routes![1]).toEqual({
        method: "post",
        path: "/create",
        handlerName: "createProduct",
        schema: mockSchema,
      });

      // Validamos los demás métodos
      expect(metadata.routes![2].method).toBe("put");
      expect(metadata.routes![3].method).toBe("patch");
      expect(metadata.routes![4].method).toBe("delete");
    });

    it("Debería lanzar error si los decoradores HTTP se aplican a algo que no es un método", () => {
      expect(() => {
        const getFn = Get("/test");
        getFn(() => {}, { kind: "field", name: "bad" } as any);
      }).toThrow();
    });
  });

  describe("Combinación de Decoradores (Controller + Methods)", () => {
    it("Deberían compartir el mismo objeto de metadata sin sobrescribirse", () => {
      @Controller("/auth")
      class AuthController {
        @Post("/login")
        login() {
          /* dummy method */
        }
      }

      // Obtenemos la metadata del controlador
      const metadata = (AuthController as any)[
        (Symbol as any).metadata
      ] as FastifyKitMetadata;

      // El decorador de clase y el de método debieron afectar el MISMO objeto de metadatos
      expect(metadata.prefix).toBe("/auth");
      expect(metadata.routes).toBeDefined();
      expect(metadata.routes).toHaveLength(1);
      expect(metadata.routes![0].handlerName).toBe("login");
    });
  });
});
