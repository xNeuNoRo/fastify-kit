import type { FastifyReply, FastifyRequest } from "fastify";
import {
  WebSocketGatewayOptions,
  WsEventHandlerMetadata,
} from "../../websockets/decorators/types.js";
import type { CanActivate } from "../guards/CanActivate.js";
import type { PipeTransform } from "../pipes/PipeTransform.js";
import type { AutoDiscoverOptions } from "../../core/discovery.js";
import type { Constructor } from "../routing/scanner/index.js";
import type { RouteDefinition } from "../routing/types.js";
import type { Interceptor } from "../interceptors/Interceptor.js";
import type { TSchema } from "@sinclair/typebox";
import type { StaticAssetsOptions } from "../interfaces/static.interface.js";
import type { Contract, ScopeType } from "../../container/DIContainer.js";
import { QueueProcessorMetadata } from "../../queues/interfaces/queue-options.js";

/**
 * @description Tipos y interfaces para la metadata de los decoradores en FastifyKit.
 */

/**
 * @description Tipo que representa los diferentes tipos de parámetros que se pueden inyectar en los controladores a través de decoradores como @Body, @Query, @Param, etc.
 */
export type ParameterType =
  | "body"
  | "query"
  | "param"
  | "headers"
  | "request"
  | "reply"
  | "ip"
  | "file"
  | "cookie"
  | "socket"
  | "wsPayload"
  | "custom"; // Para permitir tipos personalizados, como @User, @AuthToken, etc.

/**
 * @description Interfaz que define las opciones de configuración para el manejo de archivos en los métodos decorados con @File.
 */
export interface FileOptions {
  /** Tamaño máximo en bytes. Ej: 5 * 1024 * 1024 (5MB) */
  maxSize?: number;
  /** Tipos MIME permitidos. Ej: ['image/jpeg', 'application/pdf'] */
  mimetypes?: string[];
  /** Modo de entrega:
   * 'buffer' => Carga el archivo entero en RAM (ideal para imágenes pequeñas).
   * 'stream' => Entrega un flujo de lectura (ideal para archivos pesados).
   * @default 'buffer'
   */
  mode?: "buffer" | "stream";
  /* Si es true, el archivo es opcional */
  optional?: boolean;
}

/**
 * @description Interfaz que representa un archivo cargado a través de un decorador como @File. Dependiendo de las opciones configuradas, el archivo puede estar disponible como un buffer en memoria o como un stream de lectura.
 */
export interface MultipartFile {
  filename: string;
  mimetype: string;
  encoding: string;
  buffer?: Buffer;
  stream?: NodeJS.ReadableStream;
}

/**
 * @description Interfaz que define la metadata de un parámetro decorado en un controlador. Esta metadata incluye el índice del parámetro en la lista de argumentos del método, el tipo de parámetro (body, query, param, etc.), una clave opcional para identificar qué parte de los datos se debe inyectar (por ejemplo, el nombre del campo en el cuerpo o en la query), y una referencia opcional a un PipeTransform que se puede usar para transformar o validar el valor antes de inyectarlo.
 */
export interface ParameterMetadata {
  index: number;
  type: ParameterType;
  key?: string;
  pipe?: Constructor<PipeTransform>;
  fileOptions?: FileOptions;
  customFactory?: (request: FastifyRequest, reply: FastifyReply) => unknown;
}

/**
 * @description Interfaz que define la metadata compartida por todos los decoradores en FastifyKit. Esta metadata incluye información sobre los guardias a nivel de clase y de ruta, así como cualquier otra información común que pueda ser utilizada por diferentes tipos de decoradores (controladores, módulos, etc.). Esta interfaz se extiende en FastifyKitMetadata para incluir información específica de controladores, rutas, módulos, etc.
 */
export type ProviderDefinition =
  | Constructor // Una clase que se puede instanciar y registrar como proveedor en el contenedor de dependencias
  | { contract: any; implementation: Constructor }; // Un objeto que define un contrato (por ejemplo, una interfaz o un token simbólico) y una implementación concreta que se debe registrar en el contenedor de dependencias.

/**
 * @description Interfaz que define la metadata compartida por todos los decoradores en FastifyKit. Esta metadata incluye información sobre los guardias a nivel de clase y de ruta, así como cualquier otra información común que pueda ser utilizada por diferentes tipos de decoradores (controladores, módulos, etc.). Esta interfaz se extiende en FastifyKitMetadata para incluir información específica de controladores, rutas, módulos, etc.
 */
export interface ModuleOptions {
  imports?: any[]; // Otros módulos que este módulo necesita importar para funcionar (Ej: Módulo de DB, Módulo de Cache, etc.)
  controllers?: Constructor[]; // Controladores a registrar en este módulo
  providers?: ProviderDefinition[]; // Servicios, Repositorios, etc. (Basicamente lo que dependa el controlador en cadena)
  exports?: Constructor[]; // Qué servicios de este módulo pueden ser usados por otros módulos
  autoDiscoverControllers?: AutoDiscoverOptions; // Opciones para auto-descubrimiento de controladores dentro de este módulo
  autoDiscoverModules?: AutoDiscoverOptions; // Opciones para auto-descubrimiento de módulos dentro de este módulo
  autoDiscoverCQRSHandlers?: AutoDiscoverOptions; // Opciones para auto-descubrimiento de handlers CQRS dentro de este módulo
}

/**
 * @description Interfaz que define la metadata de los decoradores en FastifyKit. Esta interfaz extiende la metadata compartida por todos los decoradores (FastifyKitMetadata) e incluye información específica para controladores, rutas, módulos, etc. La metadata se utiliza internamente para almacenar información sobre cómo deben comportarse los controladores, qué rutas deben registrar, qué guardias aplicar, etc.
 */
export interface ScheduledTaskMetadata {
  methodName: string | symbol; // El nombre del método decorado con @ScheduledTask
  cronExpression: string; // La expresión cron que define cuándo se debe ejecutar la tarea programada
}

/**
 * @description Interfaz que define las opciones de configuración para el rate limiting en los métodos decorados con @RateLimit. Estas opciones permiten configurar el número máximo de solicitudes permitidas dentro de una ventana de tiempo, cuánto tiempo debe durar esa ventana, cuántas veces puede excederse el límite antes de ser bloqueado totalmente, si debe seguir contando incluso tras el bloqueo, y una lista de IPs o identificadores que están exentos del rate limit.
 */
export interface RateLimitOptions {
  max: number; // Número máximo de solicitudes permitidas dentro de la ventana de tiempo
  timeWindow: string | number; // Ej: "1m" para 1 minuto, "30s" para 30 segundos, o un número en milisegundos
  ban?: number; // Cuántas veces puede excederse antes de ser bloqueado totalmente
  continueExceeding?: boolean; // Si debe seguir contando incluso tras el bloqueo
  allowList?: string[]; // Lista de IPs o identificadores que están exentos del rate limit
}

/**
 * @description Interfaz que define la metadata compartida por todos los decoradores en FastifyKit. Esta metadata incluye información sobre los guardias a nivel de clase y de ruta, así como cualquier otra información común que pueda ser utilizada por diferentes tipos de decoradores (controladores, módulos, etc.). Esta interfaz se extiende en FastifyKitMetadata para incluir información específica de controladores, rutas, módulos, etc.
 */
/**
 * @description Tipos para la integración de OpenAPI en los decoradores de FastifyKit.
 * Estos tipos siguen la especificación OpenAPI 3.1 y se utilizan para definir
 * tags, operaciones, respuestas, seguridad, parámetros y propiedades de esquemas.
 */

/**
 * @description Opciones para el decorador \@ApiProperty, que documenta una propiedad de un DTO/Modelo.
 */
export interface ApiPropertyOptions {
  /** Ejemplo del valor para documentación. Se muestra en el modal de esquemas de Scalar. */
  example?: unknown;
  /** Descripción legible de la propiedad. */
  description?: string;
  /** Formato adicional (ej: "date-time", "email", "uuid", "uri", "int64"). */
  format?: string;
  /** Longitud mínima para strings. */
  minLength?: number;
  /** Longitud máxima para strings. */
  maxLength?: number;
  /** Valor mínimo para números. */
  minimum?: number;
  /** Valor máximo para números. */
  maximum?: number;
  /** Valores permitidos (enum). */
  enum?: unknown[];
  /** Valor por defecto. */
  default?: unknown;
  /** Si la propiedad es de solo lectura (no se envía en POST/PUT). */
  readOnly?: boolean;
  /** Si la propiedad es de solo escritura (no se devuelve en GET). */
  writeOnly?: boolean;
  /** Si la propiedad puede ser null. */
  nullable?: boolean;
  /** Si la propiedad está deprecada. */
  deprecated?: boolean;
  /** Título para documentación. */
  title?: string;
}

/**
 * @description Opciones para el decorador \@ApiSchema, que registra un DTO/Modelo como esquema reutilizable en OpenAPI.
 */
export interface ApiSchemaOptions {
  /** Nombre único del esquema en components/schemas (ej: "User", "CreateUserDto"). */
  name: string;
  /** Descripción del esquema. */
  description?: string;
  /** Si el esquema está deprecado. */
  deprecated?: boolean;
  /** Referencia a constructores para composición oneOf (unión discriminada). */
  oneOf?: Constructor[];
  /** Referencia a constructores para composición anyOf. */
  anyOf?: Constructor[];
  /** Referencia a constructores para composición allOf (herencia). */
  allOf?: Constructor[];
  /** Configuración del discriminador para oneOf/anyOf. */
  discriminator?: {
    propertyName: string;
    mapping?: Record<string, string>;
  };
}

/**
 * @description Opciones para el decorador \@ApiOperation, que documenta un endpoint completo.
 */
export interface ApiOperationOptions {
  /** Resumen corto de la operación (aparece en la lista de endpoints). */
  summary?: string;
  /** Descripción larga de la operación (soporta Markdown). */
  description?: string;
  /** Si el endpoint está deprecado. */
  deprecated?: boolean;
  /** Documentación externa asociada. */
  externalDocs?: {
    description?: string;
    url: string;
  };
  /** ID único para la operación (por defecto: ControllerName_methodName). */
  operationId?: string;
}

/**
 * @description Opciones para el decorador \@ApiResponse, que documenta una posible respuesta HTTP de un endpoint.
 */
export interface ApiResponseOptions {
  /** Código HTTP de la respuesta (200, 201, 400, 401, 404, 500, etc.). */
  status: number;
  /** Descripción de la respuesta. */
  description: string;
  /** Clase DTO que define el esquema del cuerpo de la respuesta. */
  type?: Constructor;
  /** Tipo MIME de la respuesta. */
  contentType?: string;
  /** Headers que se devuelven en la respuesta. */
  headers?: Record<string, {
    description?: string;
    schema?: Record<string, unknown>;
  }>;
  /** Links HATEOAS asociados a la respuesta. */
  links?: Record<string, {
    operationId?: string;
    description?: string;
    parameters?: Record<string, string>;
  }>;
}

/**
 * @description Opciones para el decorador \@ApiParam, que documenta un parámetro de ruta (path parameter).
 */
export interface ApiParamOptions {
  /** Nombre del parámetro (debe coincidir con :name en la ruta). */
  name: string;
  /** Descripción del parámetro. */
  description?: string;
  /** Ejemplo del valor. */
  example?: unknown;
  /** Si el parámetro es requerido (default: true para path params). */
  required?: boolean;
  /** Si el parámetro está deprecado. */
  deprecated?: boolean;
}

/**
 * @description Opciones para el decorador \@ApiQuery, que documenta un query parameter.
 */
export interface ApiQueryOptions {
  /** Nombre del query parameter. */
  name: string;
  /** Descripción del parámetro. */
  description?: string;
  /** Ejemplo del valor. */
  example?: unknown;
  /** Si el parámetro es requerido. */
  required?: boolean;
  /** Si el parámetro está deprecado. */
  deprecated?: boolean;
  /** Estilo de serialización (para arrays/objetos): "form", "spaceDelimited", "pipeDelimited", "deepObject". */
  style?: "form" | "spaceDelimited" | "pipeDelimited" | "deepObject";
  /** Si se debe usar explode para arrays/objetos. */
  explode?: boolean;
}

/**
 * @description Opciones para el decorador \@ApiHeader, que documenta un header de la request.
 */
export interface ApiHeaderOptions {
  /** Nombre del header. */
  name: string;
  /** Descripción del header. */
  description?: string;
  /** Ejemplo del valor. */
  example?: unknown;
  /** Si el header es requerido. */
  required?: boolean;
  /** Si el header está deprecado. */
  deprecated?: boolean;
}

export type FastifyKitMetadata = DecoratorMetadata & {
  injections?: {
    propertyName: string | symbol;
    contractOrResolver: Contract<unknown> | (() => Contract<unknown>);
    optional?: boolean;
  }[]; // Metadata para inyecciones de dependencias con @Inject
  parameters?: Record<string | symbol, ParameterMetadata[]>; // Metadata de parámetros, mapeada por el nombre del método
  routes?: RouteDefinition[]; // Para almacenar información de rutas a nivel de método (método HTTP, path, etc.)
  prefix?: string; // Para controladores, el prefijo de ruta (Ej: "books" para rutas como "/books", "/books/:id", etc.)
  classGuards?: Constructor<CanActivate>[]; // Guard a nivel de clase
  routeGuards?: Record<string | symbol, Constructor<CanActivate>[]>; // Guard a nivel de ruta, mapeado por el nombre del método
  moduleOptions?: ModuleOptions; // Opciones de módulo para clases decoradas con @Module
  methodVersions?: Record<string | symbol, string>; // Versiones a nivel de método
  scheduledTasks?: ScheduledTaskMetadata[]; // Metadata para tareas programadas
  rateLimits?: Record<string | symbol, RateLimitOptions>; // Metadata para rate limiting a nivel de método
  wsGateway?: WebSocketGatewayOptions; // Metadata para gateways de WebSockets a nivel de clase
  wsEvents?: WsEventHandlerMetadata[]; // Metadata para eventos de WebSockets a nivel de método
  classInterceptors?: Constructor<Interceptor>[]; // Interceptores a nivel de clase
  routeInterceptors?: Record<string | symbol, Constructor<Interceptor>[]>; // Interceptores a nivel de ruta, mapeado por el nombre del método
  responsesSchema?: Record<string | symbol, Record<number, TSchema>>; // Esquemas de respuesta a nivel de método, mapeados por el nombre del método y el código HTTP
  staticAssets?: StaticAssetsOptions; // Opciones para servir archivos estáticos a nivel de clase
  queue?: QueueProcessorMetadata; // Metadata para procesadores de colas a nivel de clase
  cqrsHandler?: boolean; // Indicador de que esta clase es un handler CQRS (Command, Query o Event Handler)
  scope?: ScopeType; // Ciclo de vida de la clase en el contenedor DI
  postConstructMethod?: string | symbol; // Nombre del método a ejecutar después de la inyección de dependencias

  // OpenAPI 3.1 Metadata
  /** Tags OpenAPI a nivel de clase (controlador). Se agrupan bajo estos tags en Scalar. */
  openApiTags?: string[];
  /** Configuración de seguridad a nivel de clase. */
  openApiClassSecurity?: { name: string; scopes?: string[] }[];
  /** Servidores alternativos a nivel de clase. */
  openApiClassServers?: { url: string; description?: string }[];
  /** Si el controlador completo debe excluirse de la documentación OpenAPI. */
  openApiExcludeController?: boolean;
  /** Operaciones OpenAPI a nivel de método (summary, description, deprecated, externalDocs, operationId). */
  openApiOperation?: Record<string | symbol, ApiOperationOptions>;
  /** Respuestas OpenAPI a nivel de método, mapeadas por nombre de método y código HTTP. */
  openApiResponseMetas?: Record<string | symbol, Record<number, ApiResponseOptions>>;
  /** Seguridad a nivel de método. */
  openApiMethodSecurity?: Record<string | symbol, { name: string; scopes?: string[] }[]>;
  /** Parámetros OpenAPI a nivel de método (path, query, header). */
  openApiParameters?: Record<string | symbol, { in: "path" | "query" | "header"; name: string; description?: string; example?: unknown; required?: boolean; deprecated?: boolean; style?: string; explode?: boolean }[]>;
  /** Si el endpoint debe excluirse de la documentación OpenAPI. */
  openApiExcludeEndpoint?: Record<string | symbol, boolean>;
  /** Propiedades del esquema del DTO (para clases decoradas con @ApiSchema). */
  openApiProperties?: Record<string, ApiPropertyOptions>;
  /** Opciones de @ApiSchema para registro en el OpenApiRegistry. */
  openApiSchema?: ApiSchemaOptions;
};
