import { describe, it, expect } from "vitest";

import { FASTIFY_KIT_METADATA_SYMBOL as metadataSymbol } from "../../../../../src/core/constants/symbols.js";
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

/** Accede a la metadata de decoradores Stage 3 de forma tipada. */
function getMetadata(cls: object): FastifyKitMetadata {
  return (cls as Record<symbol, unknown>)[metadataSymbol] as FastifyKitMetadata;
}

describe("Decoradores OpenAPI", () => {
  describe("@ApiTags", () => {
    @ApiTags("Users", "Admin")
    @Controller("/test")
    class TagsCtrl {
      @Get("/")
      get() {
        return "ok";
      }
    }

    it("Deberia almacenar los tags en la metadata de la clase", () => {
      const meta = getMetadata(TagsCtrl);
      expect(meta.openApiTags).toEqual(["Users", "Admin"]);
    });

    it("Deberia lanzar error si se aplica a un metodo", () => {
      expect(() => {
        @Controller("/test")
        class _Local {
          @Get("/")
          get() {}
        }
        // Forzamos aplicar @ApiTags a un contexto de metodo para probar validacion
        (ApiTags("Test") as CallableFunction)(undefined, {
          kind: "method",
          name: "get",
        } as ClassMethodDecoratorContext);
      }).toThrow(/@ApiTags solo puede aplicarse a clases/);
    });
  });

  describe("@ApiOperation", () => {
    @Controller("/test")
    class OperationCtrl {
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

    it("Deberia almacenar summary, description, deprecated y externalDocs", () => {
      const meta = getMetadata(OperationCtrl);
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
    class UserDto {}

    @Controller("/test")
    class ResponseCtrl {
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

    it("Deberia almacenar respuestas con codigo HTTP", () => {
      const meta = getMetadata(ResponseCtrl);
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
        (
          ApiResponseDoc({ status: 200, description: "ok" }) as CallableFunction
        )(undefined, { kind: "class" } as ClassDecoratorContext);
      }).toThrow(/@ApiResponseDoc solo puede aplicarse a métodos/);
    });
  });

  describe("@ApiBearerAuth", () => {
    @ApiBearerAuth()
    @Controller("/test")
    class AuthClassCtrl {
      @Get("/")
      get() {
        return "ok";
      }
    }

    it("Deberia almacenar bearerAuth a nivel de clase", () => {
      const meta = getMetadata(AuthClassCtrl);
      expect(meta.openApiClassSecurity).toBeDefined();
      expect(meta.openApiClassSecurity![0].name).toBe("bearerAuth");
    });

    @Controller("/test")
    class AuthMethodCtrl {
      @Get("/")
      @ApiBearerAuth("customBearer")
      get() {
        return "ok";
      }
    }

    it("Deberia almacenar bearerAuth a nivel de metodo", () => {
      const meta = getMetadata(AuthMethodCtrl);
      const methodSec = meta.openApiMethodSecurity?.["get"];
      expect(methodSec).toBeDefined();
      expect(methodSec![0].name).toBe("customBearer");
    });
  });

  describe("@ApiSecurity", () => {
    @ApiSecurity("oauth2", ["read:users", "write:users"])
    @Controller("/test")
    class SecurityClassCtrl {
      @Get("/")
      get() {
        return "ok";
      }
    }

    it("Deberia almacenar security scheme con scopes a nivel de clase", () => {
      const meta = getMetadata(SecurityClassCtrl);
      expect(meta.openApiClassSecurity).toBeDefined();
      expect(meta.openApiClassSecurity![0].name).toBe("oauth2");
      expect(meta.openApiClassSecurity![0].scopes).toEqual([
        "read:users",
        "write:users",
      ]);
    });

    @Controller("/test")
    class SecurityMethodCtrl {
      @Get("/")
      @ApiSecurity("apiKeyAuth")
      get() {
        return "ok";
      }
    }

    it("Deberia almacenar apiKey a nivel de metodo", () => {
      const meta = getMetadata(SecurityMethodCtrl);
      const methodSec = meta.openApiMethodSecurity?.["get"];
      expect(methodSec).toBeDefined();
      expect(methodSec![0].name).toBe("apiKeyAuth");
    });
  });

  describe("@ApiParam", () => {
    @Controller("/test")
    class ParamCtrl {
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

    it("Deberia almacenar parametros de ruta", () => {
      const meta = getMetadata(ParamCtrl);
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
    @Controller("/test")
    class QueryCtrl {
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

    it("Deberia almacenar query parameters", () => {
      const meta = getMetadata(QueryCtrl);
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

    @Controller("/test")
    class QueryStyleCtrl {
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

    it("Deberia almacenar style y explode para query params", () => {
      const meta = getMetadata(QueryStyleCtrl);
      const params = meta.openApiParameters?.["filter"];
      expect(params![0].style).toBe("pipeDelimited");
      expect(params![0].explode).toBe(false);
    });
  });

  describe("@ApiHeader", () => {
    @Controller("/test")
    class HeaderCtrl {
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

    it("Deberia almacenar headers", () => {
      const meta = getMetadata(HeaderCtrl);
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
    @ApiSchema({ name: "TestDto", description: "DTO de prueba" })
    class TestDto {
      @ApiProperty({ example: 42, description: "El ID" })
      id!: number;

      @ApiProperty({ example: "Angel", minLength: 3, maxLength: 50 })
      username!: string;
    }

    it("Deberia almacenar metadatos de propiedad en la clase", () => {
      const inst = new TestDto();
      const props = (
        Object.getPrototypeOf(inst).constructor as Record<symbol, unknown>
      )[OPENAPI_PROPERTY_METADATA] as Record<string, unknown>;
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
    @ApiSchema({ name: "User", description: "Entidad de usuario" })
    class UserDto {
      name!: string;
    }

    it("Deberia almacenar opciones de esquema en metadata", () => {
      const meta = getMetadata(UserDto);
      expect(meta.openApiSchema).toBeDefined();
      expect(meta.openApiSchema!.name).toBe("User");
      expect(meta.openApiSchema!.description).toBe("Entidad de usuario");
    });

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

    it("Deberia almacenar oneOf con discriminador", () => {
      const meta = getMetadata(AnimalDto);
      expect(meta.openApiSchema!.oneOf).toEqual([CatDto, DogDto]);
      expect(meta.openApiSchema!.discriminator).toEqual({
        propertyName: "type",
        mapping: { cat: "Cat", dog: "Dog" },
      });
    });
  });

  describe("@ApiExample", () => {
    @ApiExample("admin", { id: 1, role: "admin" })
    @ApiExample(
      "user",
      { id: 2, role: "user" },
      "Usuario basico",
      "Ejemplo de usuario regular",
    )
    class ExampleUserDto {}

    it("Deberia almacenar ejemplos en la clase", () => {
      const examples = (ExampleUserDto as Record<symbol, unknown>)[
        OPENAPI_EXAMPLES_METADATA
      ] as Record<string, unknown>;
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
    @Controller("/test")
    class ExcludeEndpointCtrl {
      @Get("/secret")
      @ApiExcludeEndpoint()
      secret() {
        return "hidden";
      }
    }

    it("Deberia marcar el endpoint como excluido", () => {
      const meta = getMetadata(ExcludeEndpointCtrl);
      expect(meta.openApiExcludeEndpoint?.["secret"]).toBe(true);
    });
  });

  describe("@ApiExcludeController", () => {
    @ApiExcludeController()
    @Controller("/internal")
    class InternalCtrl {
      @Get("/")
      get() {
        return "ok";
      }
    }

    it("Deberia marcar el controlador como excluido", () => {
      const meta = getMetadata(InternalCtrl);
      expect(meta.openApiExcludeController).toBe(true);
    });
  });

  describe("@ApiServer", () => {
    @ApiServer("https://uploads.example.com", "Servidor de archivos")
    @Controller("/files")
    class ServerCtrl {
      @Post("/")
      upload() {
        return "ok";
      }
    }

    it("Deberia almacenar servidores a nivel de clase", () => {
      const meta = getMetadata(ServerCtrl);
      expect(meta.openApiClassServers).toBeDefined();
      expect(meta.openApiClassServers![0]).toEqual({
        url: "https://uploads.example.com",
        description: "Servidor de archivos",
      });
    });
  });
});
