/**
 * @description Tipos para schemas OpenAPI 3.1 usados en el OpenApiRegistry.
 * Define un subset de JSON Schema draft 2020-12 compatible con TypeBox y OpenAPI 3.1.
 */

/**
 * @description Objeto de schema OpenAPI 3.1 minimal.
 * Cubre los casos más comunes para documentación de DTOs y respuestas.
 */
export interface OpenApiSchemaObject {
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";
  title?: string;
  description?: string;
  example?: unknown;
  format?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  enum?: unknown[];
  default?: unknown;
  readOnly?: boolean;
  writeOnly?: boolean;
  nullable?: boolean;
  deprecated?: boolean;
  properties?: Record<string, OpenApiSchemaObject>;
  required?: string[];
  items?: OpenApiSchemaObject;
  oneOf?: OpenApiSchemaObject[];
  anyOf?: OpenApiSchemaObject[];
  allOf?: OpenApiSchemaObject[];
  discriminator?: {
    propertyName: string;
    mapping?: Record<string, string>;
  };
  $ref?: string;
  content?: Record<string, { schema?: OpenApiSchemaObject }>;
  headers?: Record<string, OpenApiSchemaObject>;
  links?: Record<string, { operationId?: string; description?: string; parameters?: Record<string, string> }>;
}

/**
 * @description Mapa de schemas OpenAPI registrados.
 */
export type OpenApiSchemas = Record<string, OpenApiSchemaObject>;
