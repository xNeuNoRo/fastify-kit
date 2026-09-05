import { describe, it, expect, beforeEach } from "vitest";

import { ApiProperty } from "../../../src/http/decorators/openapi/ApiProperty.js";
import { ApiSchema } from "../../../src/http/decorators/openapi/ApiSchema.js";
import { OpenApiRegistry } from "../../../src/openapi/OpenApiRegistry.js";

if (!(Symbol as any).metadata) {
  (Symbol as any).metadata = Symbol.for("Symbol.metadata");
}

describe("OpenApiRegistry (Schema Registry)", () => {
  let registry: OpenApiRegistry;

  beforeEach(() => {
    registry = new OpenApiRegistry();
  });

  describe("registerSchema()", () => {
    it("Deberia registrar un DTO con @ApiSchema y @ApiProperty", () => {
      @ApiSchema({ name: "User", description: "Entidad de usuario" })
      class UserDto {
        @ApiProperty({ example: 1, description: "ID unico" })
        id!: number;

        @ApiProperty({
          example: "angel",
          minLength: 3,
          maxLength: 50,
        })
        username!: string;

        @ApiProperty({ example: "angel@example.com", format: "email" })
        email!: string;
      }

      const schema = registry.registerSchema(UserDto);

      expect(schema.type).toBe("object");
      expect(schema.description).toBe("Entidad de usuario");
      expect(schema.properties).toBeDefined();
      expect(schema.properties!.id.description).toBe("ID unico");
      expect(schema.properties!.id.example).toBe(1);
      expect(schema.properties!.username.minLength).toBe(3);
      expect(schema.properties!.username.maxLength).toBe(50);
      expect(schema.properties!.email.format).toBe("email");
    });

    it("Deberia deduplicar schemas con el mismo nombre", () => {
      @ApiSchema({ name: "Product", description: "Producto" })
      class ProductDto {
        @ApiProperty({ example: 1 })
        id!: number;
      }

      const schema1 = registry.registerSchema(ProductDto);
      const schema2 = registry.registerSchema(ProductDto);

      expect(schema1).toBe(schema2);
      expect(registry.getComponentsSchemas().Product).toBeDefined();
    });

    it("Deberia lanzar error si la clase no tiene @ApiSchema", () => {
      class PlainClass {
        name!: string;
      }

      expect(() => registry.registerSchema(PlainClass as any)).toThrow(
        /@ApiSchema/,
      );
    });

    it("Deberia marcar propiedades como required por defecto", () => {
      @ApiSchema({ name: "Task", description: "Tarea" })
      class TaskDto {
        @ApiProperty({ example: "Hacer compras" })
        title!: string;

        @ApiProperty({ example: "Comprar leche y pan" })
        description!: string;
      }

      const schema = registry.registerSchema(TaskDto);

      expect(schema.required).toBeDefined();
      expect(schema.required).toContain("title");
      expect(schema.required).toContain("description");
    });
  });

  describe("getComponentsSchemas()", () => {
    it("Deberia devolver los schemas registrados", () => {
      @ApiSchema({ name: "Cat", description: "Gato" })
      class CatDto {
        @ApiProperty({ example: "Misu" })
        name!: string;
      }

      @ApiSchema({ name: "Dog", description: "Perro" })
      class DogDto {
        @ApiProperty({ example: "Firulais" })
        name!: string;
      }

      registry.registerSchema(CatDto);
      registry.registerSchema(DogDto);

      const components = registry.getComponentsSchemas();
      expect(Object.keys(components)).toEqual(["Cat", "Dog"]);
      expect(components.Cat.type).toBe("object");
      expect(components.Dog.type).toBe("object");
    });
  });

  describe("resolveToSchema()", () => {
    it("Deberia devolver $ref para clases con @ApiSchema", () => {
      @ApiSchema({ name: "User", description: "Usuario" })
      class UserDto {
        @ApiProperty({ example: 1 })
        id!: number;
      }

      const resolved = registry.resolveToSchema(UserDto);
      expect(resolved).toEqual({
        $ref: "#/components/schemas/User",
      });
    });

    it("Deberia registrar automaticamente si no esta en el registry", () => {
      @ApiSchema({ name: "Auto", description: "Auto" })
      class AutoDto {
        @ApiProperty({ example: "Tsuru" })
        model!: string;
      }

      // No llamamos a registerSchema primero
      const resolved = registry.resolveToSchema(AutoDto);
      expect(resolved).toEqual({
        $ref: "#/components/schemas/Auto",
      });
      expect(registry.getComponentsSchemas().Auto).toBeDefined();
    });
  });

  describe("oneOf / anyOf / allOf (composicion)", () => {
    it("Deberia generar oneOf con $ref a los schemas miembro", () => {
      @ApiSchema({ name: "Cat", description: "Gato" })
      class CatDto {
        @ApiProperty({ example: "Misu" })
        name!: string;
      }

      @ApiSchema({ name: "Dog", description: "Perro" })
      class DogDto {
        @ApiProperty({ example: "Firulais" })
        name!: string;
      }

      @ApiSchema({
        name: "Animal",
        oneOf: [CatDto, DogDto],
        discriminator: {
          propertyName: "type",
          mapping: {
            cat: "#/components/schemas/Cat",
            dog: "#/components/schemas/Dog",
          },
        },
      })
      class AnimalDto {}

      registry.registerSchema(CatDto);
      registry.registerSchema(DogDto);
      const schema = registry.registerSchema(AnimalDto);

      expect(schema.oneOf).toBeDefined();
      if (!schema.oneOf) return;
      expect(schema.oneOf).toHaveLength(2);
      expect(schema.oneOf[0]).toEqual({
        $ref: "#/components/schemas/Cat",
      });
      expect(schema.oneOf[1]).toEqual({
        $ref: "#/components/schemas/Dog",
      });
      expect(schema.discriminator).toEqual({
        propertyName: "type",
        mapping: {
          cat: "#/components/schemas/Cat",
          dog: "#/components/schemas/Dog",
        },
      });
    });
  });

  describe("clear()", () => {
    it("Deberia limpiar todos los schemas", () => {
      @ApiSchema({ name: "Test", description: "Test" })
      class TestDto {
        @ApiProperty({ example: 1 })
        id!: number;
      }

      registry.registerSchema(TestDto);
      expect(Object.keys(registry.getComponentsSchemas())).toHaveLength(1);

      registry.clear();
      expect(Object.keys(registry.getComponentsSchemas())).toHaveLength(0);
    });
  });
});
