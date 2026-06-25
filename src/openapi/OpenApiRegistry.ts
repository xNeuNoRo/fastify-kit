import type { Constructor } from "../http/routing/scanner/index.js";
import type { FastifyKitMetadata } from "../http/decorators/types.js";
import type { TSchema } from "@sinclair/typebox";
import type { OpenApiSchemaObject } from "./types.js";
import { FASTIFY_KIT_METADATA_SYMBOL as metadataSymbol } from "../core/constants/symbols.js";

/**
 * @description Registro central de schemas reutilizables para OpenAPI 3.1.
 * Recolecta clases decoradas con \@ApiSchema y las expone como componentes
 * en `components/schemas` del spec OpenAPI. Soporta deduplicación,
 * composición (oneOf, anyOf, allOf) y resolución de referencias $ref.
 */
export class OpenApiRegistry {
  /** Schemas registrados, indexados por su nombre de componente. */
  private schemas: Map<string, OpenApiSchemaObject> = new Map();

  /** Clases registradas, indexadas por su nombre de componente. */
  private schemaClasses: Map<string, Constructor> = new Map();

  /**
   * @description Registra una clase DTO decorada con \@ApiSchema en el registry.
   * Se llama automáticamente al llamar a `OpenApiRegistry.registerSchema(cls)`.
   *
   * @param cls La clase DTO decorada con \@ApiSchema.
   * @returns El objeto schema OpenAPI registrado.
   */
  registerSchema(cls: Constructor): OpenApiSchemaObject {
    const meta = (cls as unknown as Record<symbol, unknown>)[
      metadataSymbol
    ] as FastifyKitMetadata;
    const options = meta?.openApiSchema;

    if (!options) {
      throw new Error(
        `[OpenApiRegistry] La clase ${cls.name} no tiene @ApiSchema. Usa @ApiSchema({ name: "..." }) para registrarla.`,
      );
    }

    const name = options.name;

    // Si ya esta registrado, devolvemos el existente (deduplicacion)
    if (this.schemas.has(name)) {
      return this.schemas.get(name)!;
    }

    // Construimos el schema JSON basado en las propiedades decoradas
    const schema: OpenApiSchemaObject = {
      type: "object",
    };

    if (options.description) {
      schema.description = options.description;
    }

    if (options.deprecated) {
      schema.deprecated = true;
    }

    // Recogemos las propiedades de la clase decoradas con @ApiProperty
    const properties = this.collectProperties(cls);
    if (Object.keys(properties).length > 0) {
      schema.properties = this.transformProperties(properties);
      schema.required = this.getRequiredProperties(properties);
      if (!schema.required.length) {
        delete schema.required;
      }
    }

    // Manejar composicion (oneOf, anyOf, allOf)
    if (options.oneOf || options.anyOf || options.allOf) {
      const compositionSchema: OpenApiSchemaObject = {};
      if (options.description) {
        compositionSchema.description = options.description;
      }

      if (options.oneOf) {
        compositionSchema.oneOf = options.oneOf.map((c) =>
          this.resolveConstructorSchema(c),
        );
      }
      if (options.anyOf) {
        compositionSchema.anyOf = options.anyOf.map((c) =>
          this.resolveConstructorSchema(c),
        );
      }
      if (options.allOf) {
        compositionSchema.allOf = options.allOf.map((c) =>
          this.resolveConstructorSchema(c),
        );
      }
      if (options.discriminator) {
        compositionSchema.discriminator = options.discriminator;
      }
      if (Object.keys(properties).length > 0) {
        compositionSchema.properties =
          this.transformProperties(properties);
      }

      this.schemas.set(name, compositionSchema);
      this.schemaClasses.set(name, cls);
      return compositionSchema;
    }

    this.schemas.set(name, schema);
    this.schemaClasses.set(name, cls);
    return schema;
  }

  /**
   * @description Resuelve una clase a su schema OpenAPI. Si la clase está registrada
   * en el registry, devuelve una referencia $ref. Si no, intenta generar el schema inline.
   *
   * @param cls La clase DTO a resolver.
   * @returns El schema OpenAPI o una referencia $ref.
   */
  resolveConstructorSchema(cls: Constructor): OpenApiSchemaObject {
    const meta = (cls as unknown as Record<symbol, unknown>)[
      metadataSymbol
    ] as FastifyKitMetadata;
    const options = meta?.openApiSchema;

    if (options && this.schemas.has(options.name)) {
      return { $ref: `#/components/schemas/${options.name}` };
    }

    // Si no esta registrada, intentamos registrarla ahora
    if (options) {
      return { $ref: `#/components/schemas/${options.name}` };
    }

    // Sin @ApiSchema, no podemos hacer referencia
    return { type: "object" };
  }

  /**
   * @description Resuelve un DTO constructor a un schema (inline o $ref) para usar en responses.
   * Si la clase tiene @ApiSchema, usa $ref. Si no, intenta construir schema desde @ApiProperty.
   *
   * @param schemaOrClass Un esquema TypeBox o una clase DTO.
   * @returns El schema OpenAPI inline o referencia $ref.
   */
  resolveToSchema(
    schemaOrClass: Constructor | TSchema,
  ): OpenApiSchemaObject {
    // Si es una clase (constructor), intentamos usar $ref
    if (typeof schemaOrClass === "function" && schemaOrClass.prototype) {
      const cls = schemaOrClass as Constructor;
      const meta = (cls as unknown as Record<symbol, unknown>)[
        metadataSymbol
      ] as FastifyKitMetadata;
      if (meta?.openApiSchema?.name) {
        // Aseguramos que esté registrado
        if (!this.schemas.has(meta.openApiSchema.name)) {
          this.registerSchema(cls);
        }
        return { $ref: `#/components/schemas/${meta.openApiSchema.name}` };
      }
      // Sin @ApiSchema, construimos inline
      return { type: "object" };
    }

    // Si es un TSchema de TypeBox, devolvemos el JSON Schema inline
    // Los TSchema de TypeBox ya son compatibles con OpenAPI 3.1
    const tschema = schemaOrClass as TSchema;
    return tschema.toJSON?.() ?? { type: "object" };
  }

  /**
   * @description Devuelve todos los schemas registrados como `components.schemas`
   * listo para inyectar en el spec OpenAPI.
   *
   * @returns Objeto `components.schemas` con todos los schemas registrados.
   */
  getComponentsSchemas(): Record<string, OpenApiSchemaObject> {
    const result: Record<string, OpenApiSchemaObject> = {};
    for (const [name, schema] of this.schemas) {
      result[name] = schema;
    }
    return result;
  }

  /**
   * @description Verifica si un nombre de schema ya está registrado.
   */
  has(name: string): boolean {
    return this.schemas.has(name);
  }

  /**
   * @description Limpia todos los schemas registrados (útil para tests).
   */
  clear(): void {
    this.schemas.clear();
    this.schemaClasses.clear();
  }

  /**
   * @description Recolecta las propiedades decoradas con @ApiProperty de una clase.
   */
  private collectProperties(
    cls: Constructor,
  ): Record<string, import("../http/decorators/types.js").ApiPropertyOptions> {
    const inst = new (cls as new () => Record<string, unknown>)();
    const constructor = Object.getPrototypeOf(inst).constructor as Record<
      symbol,
      unknown
    >;
    const symbol: symbol = Symbol.for("fastifykit:openapi:property");
    return (constructor[symbol] as Record<
      string,
      import("../http/decorators/types.js").ApiPropertyOptions
    >) || {};
  }

  /**
   * @description Transforma las propiedades recolectadas a propiedades de schema OpenAPI.
   */
  private transformProperties(
    properties: Record<string, import("../http/decorators/types.js").ApiPropertyOptions>,
  ): Record<string, OpenApiSchemaObject> {
    const result: Record<string, OpenApiSchemaObject> = {};

    for (const [propName, options] of Object.entries(properties)) {
      const propSchema: OpenApiSchemaObject = { type: "string" };

      if (options.description) {
        propSchema.description = options.description;
      }
      if (options.example !== undefined) {
        propSchema.example = options.example;
      }
      if (options.format) {
        propSchema.format = options.format;
      }
      if (options.minLength !== undefined) {
        propSchema.minLength = options.minLength;
      }
      if (options.maxLength !== undefined) {
        propSchema.maxLength = options.maxLength;
      }
      if (options.minimum !== undefined) {
        propSchema.minimum = options.minimum;
      }
      if (options.maximum !== undefined) {
        propSchema.maximum = options.maximum;
      }
      if (options.enum) {
        propSchema.enum = options.enum;
      }
      if (options.default !== undefined) {
        propSchema.default = options.default;
      }
      if (options.readOnly) {
        propSchema.readOnly = true;
      }
      if (options.writeOnly) {
        propSchema.writeOnly = true;
      }
      if (options.nullable) {
        propSchema.nullable = true;
      }
      if (options.deprecated) {
        propSchema.deprecated = true;
      }
      if (options.title) {
        propSchema.title = options.title;
      }

      result[propName] = propSchema;
    }

    return result;
  }

  /**
   * @description Obtiene las propiedades requeridas de un conjunto de opciones.
   */
  private getRequiredProperties(
    properties: Record<string, import("../http/decorators/types.js").ApiPropertyOptions>,
  ): string[] {
    return Object.entries(properties)
      .filter(
        ([, options]) =>
          !options.optional &&
          options.required !== false &&
          options.writeOnly !== true,
      )
      .map(([name]) => name);
  }
}

/**
 * @description Instancia singleton del OpenApiRegistry.
 * Usar esta instancia para registrar schemas y obtener components.
 */
export const openApiRegistry = new OpenApiRegistry();
