import { describe, it, expect } from "vitest";

import { Controller } from "../../../../../src/http/decorators/controller.js";
import { Get, Post } from "../../../../../src/http/decorators/methods.js";
import {
  ApiTags,
  ApiOperation,
  ApiResponseDoc,
  ApiBearerAuth,
  ApiSecurity,
  ApiParam,
  ApiQuery,
  ApiHeader,
  ApiProperty,
  OPENAPI_PROPERTY_METADATA,
  ApiSchema,
  ApiExample,
  OPENAPI_EXAMPLES_METADATA,
  ApiExcludeEndpoint,
  ApiExcludeController,
  ApiServer,
} from "../../../../../src/http/decorators/openapi/index.js";
import type { FastifyKitMetadata } from "../../../../../src/http/decorators/types.js";

if (!(Symbol as any).metadata) {
  (Symbol as any).metadata = Symbol.for("Symbol.metadata");
}

function getMetadata(cls: any): FastifyKitMetadata {
  return cls[(Symbol as any).metadata] as FastifyKitMetadata;
}

describe("Decoradores OpenAPI", () => {
  describe("@ApiTags", () => {
    it("Deberia almacenar los tags en la metadata de la clase", () => {
      @ApiTags("Users", "Admin")
      @Controller("/test")
      class TestCtrl {
        @Get("/")
        get() {
          return "ok";
        }
      }

      const meta = getMetadata(TestCtrl);
      expect(meta.openApiTags).toEqual(["Users", "Admin"]);
    });

    it("Deberia lanzar error si se aplica a un metodo", () => {
      class TestCtrl {
        @Get("/")
        // @ts-expect-error probamos runtime
        static get() {
          return "ok";
        }
      }

      expect(() => {
        // Forzamos aplicar a metodo para probar validacion
        void (ApiTags as any)("Test")(TestCtrl.prototype.get, {
          kind: "method",
          name: "get",
        } as any);
      }).toThrow();
    });
  });

  describe("@ApiOperation", () => {
    it("Deberia almacenar summary, description, deprecated y externalDocs", () => {
      @Controller("/test")
      class TestCtrl {
        @Get("/")
        @ApiOperation({
          summary: "Obtener lista",
          description: "Devuelve todos los items",
          deprecated: true,
          operationId: "getItems",
          externalDocs: { url: "https://docs.example.com" },
        })
        get() {
          return "ok";
        }
      }

      const meta = getMetadata(TestCtrl);
      const op = meta.openApiOperation?.["get"];
      expect(op).toBeDefined();
      expect(op!.summary).toBe("Obtener lista");
      expect(op!.description).toBe("Devuelve todos los items");
      expect(op!.deprecated).toBe(true);
      expect(op!.operationId).toBe("getItems");
      expect(op!.externalDocs).toEqual({ url: "https://docs.example.com" });
    });
  });

  describe("@ApiResponseDoc", () => {
    it("Deberia almacenar respuestas con codigo HTTP", () => {
      class UserDto {}
      // ErrorDto no se usa en asserts pero es parte del escenario

      @Controller("/test")
      class TestCtrl {
        @Post("/")
        @ApiResponseDoc({
          status: 201,
          description: "Creado exitosamente",
          type: UserDto,
        })
        @ApiResponseDoc({ status: 400, description: "Datos invalidos" })
        @ApiResponseDoc({ status: 500, description: "Error interno" })
        create() {
          return "ok";
        }
      }

      const meta = getMetadata(TestCtrl);
      const responses = meta.openApiResponseMetas?.["create"];
      expect(responses).toBeDefined();
      expect(responses![201].status).toBe(201);
      expect(responses![201].description).toBe("Creado exitosamente");
      expect(responses![400].status).toBe(400);
      expect(responses![400].description).toBe("Datos invalidos");
      expect(responses![500].status).toBe(500);
      expect(responses![500].description).toBe("Error interno");
    });

    it("Deberia lanzar error si se aplica a una clase", () => {
      expect(() => {
        void (ApiResponseDoc as any)({
          status: 200,
          description: "ok",
        })(TestCtrl as any, { kind: "class" } as any);
      }).toThrow();
    });
  });

  describe("@ApiBearerAuth", () => {
    it("Deberia almacenar bearerAuth a nivel de clase", () => {
      @ApiBearerAuth()
      @Controller("/test")
      class TestCtrl {
        @Get("/")
        get() {
          return "ok";
        }
      }

      const meta = getMetadata(TestCtrl);
      expect(meta.openApiClassSecurity).toBeDefined();
      expect(meta.openApiClassSecurity![0].name).toBe("bearerAuth");
    });

    it("Deberia almacenar bearerAuth a nivel de metodo", () => {
      @Controller("/test")
      class TestCtrl {
        @Get("/")
        @ApiBearerAuth("customBearer")
        get() {
          return "ok";
        }
      }

      const meta = getMetadata(TestCtrl);
      const methodSec = meta.openApiMethodSecurity?.["get"];
      expect(methodSec).toBeDefined();
      expect(methodSec![0].name).toBe("customBearer");
    });
  });

  describe("@ApiSecurity", () => {
    it("Deberia almacenar security scheme con scopes a nivel de clase", () => {
      @ApiSecurity("oauth2", ["read:users", "write:users"])
      @Controller("/test")
      class TestCtrl {
        @Get("/")
        get() {
          return "ok";
        }
      }

      const meta = getMetadata(TestCtrl);
      expect(meta.openApiClassSecurity).toBeDefined();
      expect(meta.openApiClassSecurity![0].name).toBe("oauth2");
      expect(meta.openApiClassSecurity![0].scopes).toEqual([
        "read:users",
        "write:users",
      ]);
    });

    it("Deberia almacenar apiKey a nivel de metodo", () => {
      @Controller("/test")
      class TestCtrl {
        @Get("/")
        @ApiSecurity("apiKeyAuth")
        get() {
          return "ok";
        }
      }

      const meta = getMetadata(TestCtrl);
      const methodSec = meta.openApiMethodSecurity?.["get"];
      expect(methodSec).toBeDefined();
      expect(methodSec![0].name).toBe("apiKeyAuth");
    });
  });

  describe("@ApiParam", () => {
    it("Deberia almacenar parametros de ruta", () => {
      @Controller("/test")
      class TestCtrl {
        @Get("/:id")
        @ApiParam({
          name: "id",
          description: "ID del recurso",
          example: "abc-123",
        })
        get(id: string) {
          return id;
        }
      }

      const meta = getMetadata(TestCtrl);
      const params = meta.openApiParameters?.["get"];
      expect(params).toBeDefined();
      expect(params![0]).toMatchObject({
        in: "path",
        name: "id",
        description: "ID del recurso",
        example: "abc-123",
        required: true,
      });
    });
  });

  describe("@ApiQuery", () => {
    it("Deberia almacenar query parameters", () => {
      @Controller("/test")
      class TestCtrl {
        @Get("/")
        @ApiQuery({
          name: "page",
          description: "Numero de pagina",
          example: 1,
          required: false,
        })
        @ApiQuery({ name: "limit", description: "Resultados", example: 20 })
        getAll() {
          return [];
        }
      }

      const meta = getMetadata(TestCtrl);
      const params = meta.openApiParameters?.["getAll"];
      expect(params).toBeDefined();
      expect(params![0]).toMatchObject({
        in: "query",
        name: "page",
        required: false,
      });
      expect(params![1]).toMatchObject({
        in: "query",
        name: "limit",
      });
    });

    it("Deberia almacenar style y explode para query params", () => {
      @Controller("/test")
      class TestCtrl {
        @Get("/")
        @ApiQuery({
          name: "ids",
          description: "IDs filtrados",
          style: "pipeDelimited",
          explode: false,
        })
        filter() {
          return [];
        }
      }

      const meta = getMetadata(TestCtrl);
      const params = meta.openApiParameters?.["filter"];
      expect(params![0].style).toBe("pipeDelimited");
      expect(params![0].explode).toBe(false);
    });
  });

  describe("@ApiHeader", () => {
    it("Deberia almacenar headers", () => {
      @Controller("/test")
      class TestCtrl {
        @Get("/")
        @ApiHeader({
          name: "X-Request-ID",
          description: "ID de trazabilidad",
          example: "req-001",
        })
        get() {
          return "ok";
        }
      }

      const meta = getMetadata(TestCtrl);
      const params = meta.openApiParameters?.["get"];
      expect(params).toBeDefined();
      expect(params![0]).toMatchObject({
        in: "header",
        name: "X-Request-ID",
        description: "ID de trazabilidad",
        example: "req-001",
      });
    });
  });

  describe("@ApiProperty", () => {
    it("Deberia almacenar metadatos de propiedad en la clase", () => {
      @ApiSchema({ name: "TestDto", description: "DTO de prueba" })
      class TestDto {
        @ApiProperty({ example: 42, description: "El ID" })
        id!: number;

        @ApiProperty({ example: "Angel", minLength: 3, maxLength: 50 })
        username!: string;
      }

      const inst = new TestDto();
      const cls = (inst as any).constructor;
      const props = cls[OPENAPI_PROPERTY_METADATA];
      expect(props).toBeDefined();
      expect(props["id"]).toEqual({ example: 42, description: "El ID" });
      expect(props["username"]).toEqual({
        example: "Angel",
        minLength: 3,
        maxLength: 50,
      });
    });
  });

  describe("@ApiSchema", () => {
    it("Deberia almacenar opciones de esquema en metadata", () => {
      @ApiSchema({ name: "User", description: "Entidad de usuario" })
      class UserDto {
        name!: string;
      }

      const meta = getMetadata(UserDto);
      expect(meta.openApiSchema).toBeDefined();
      expect(meta.openApiSchema!.name).toBe("User");
      expect(meta.openApiSchema!.description).toBe("Entidad de usuario");
    });

    it("Deberia almacenar oneOf con discriminador", () => {
      class CatDto {}
      class DogDto {}

      @ApiSchema({
        name: "Animal",
        oneOf: [CatDto, DogDto],
        discriminator: {
          propertyName: "type",
          mapping: { cat: "Cat", dog: "Dog" },
        },
      })
      abstract class AnimalDto {}

      const meta = getMetadata(AnimalDto);
      expect(meta.openApiSchema!.oneOf).toEqual([CatDto, DogDto]);
      expect(meta.openApiSchema!.discriminator).toEqual({
        propertyName: "type",
        mapping: { cat: "Cat", dog: "Dog" },
      });
    });
  });

  describe("@ApiExample", () => {
    it("Deberia almacenar ejemplos en la clase", () => {
      @ApiExample("admin", { id: 1, role: "admin" })
      @ApiExample(
        "user",
        { id: 2, role: "user" },
        "Usuario basico",
        "Ejemplo de usuario regular",
      )
      class UserDto {}

      const cls = UserDto as any;
      const examples = cls[OPENAPI_EXAMPLES_METADATA];
      expect(examples).toBeDefined();
      expect(examples["admin"]).toEqual({
        value: { id: 1, role: "admin" },
        summary: undefined,
        description: undefined,
      });
      expect(examples["user"]).toEqual({
        value: { id: 2, role: "user" },
        summary: "Usuario basico",
        description: "Ejemplo de usuario regular",
      });
    });
  });

  describe("@ApiExcludeEndpoint", () => {
    it("Deberia marcar el endpoint como excluido", () => {
      @Controller("/test")
      class TestCtrl {
        @Get("/secret")
        @ApiExcludeEndpoint()
        secret() {
          return "hidden";
        }
      }

      const meta = getMetadata(TestCtrl);
      expect(meta.openApiExcludeEndpoint?.["secret"]).toBe(true);
    });
  });

  describe("@ApiExcludeController", () => {
    it("Deberia marcar el controlador como excluido", () => {
      @ApiExcludeController()
      @Controller("/internal")
      class InternalCtrl {
        @Get("/")
        get() {
          return "ok";
        }
      }

      const meta = getMetadata(InternalCtrl);
      expect(meta.openApiExcludeController).toBe(true);
    });
  });

  describe("@ApiServer", () => {
    it("Deberia almacenar servidores a nivel de clase", () => {
      @ApiServer("https://uploads.example.com", "Servidor de archivos")
      @Controller("/files")
      class FilesCtrl {
        @Post("/")
        upload() {
          return "ok";
        }
      }

      const meta = getMetadata(FilesCtrl);
      expect(meta.openApiClassServers).toBeDefined();
      expect(meta.openApiClassServers![0]).toEqual({
        url: "https://uploads.example.com",
        description: "Servidor de archivos",
      });
    });
  });
});
