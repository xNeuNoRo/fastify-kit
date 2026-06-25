import type {
  FastifyInstance,
  FastifyServerOptions,
} from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyCookieOptions } from "@fastify/cookie";
import type { FastifyJWTOptions } from "@fastify/jwt";
import type { FastifyMultipartOptions } from "@fastify/multipart";
import type { CreateRateLimitOptions } from "@fastify/rate-limit";
import type { FastifyCorsOptions } from "@fastify/cors";
import type { FastifyHelmetOptions } from "@fastify/helmet";
import type { ServerOptions as HttpsServerOptions } from "node:https";
import type { TSchema } from "@sinclair/typebox";
import type { StaticAssetsOptions } from "../http/interfaces/static.interface.js";
import type { FastifyKitWebRtcConfig } from "./interfaces/webrtc.interface.js";
import { QueueOptions } from "./interfaces/queue.interface.js";
import { DistributedOptions } from "./interfaces/distributed.interface.js";
import { BootstrapPipeline } from "./bootstrap/BootstrapPipeline.js";
import { PreFlightStep } from "./bootstrap/steps/PreFlightStep.js";
import { FastifyInstanceStep } from "./bootstrap/steps/FastifyInstanceStep.js";
import { ModuleDiscoveryStep } from "./bootstrap/steps/ModuleDiscoveryStep.js";
import { CorePluginsStep } from "./bootstrap/steps/CorePluginsStep.js";
import { LifecycleAndRoutesStep } from "./bootstrap/steps/LifecycleAndRoutesStep.js";
import { BootstrapHooksStep } from "./bootstrap/steps/BootstrapHooksStep.js";
import { GracefulShutdownStep } from "./bootstrap/steps/GracefulShutdownStep.js";
import { ObservabilityBootstrapStep } from "../observability/bootstrap/ObservabilityBootstrapStep.js";
import { ObservabilityInstrumentationStep } from "../observability/bootstrap/ObservabilityInstrumentationStep.js";
import type { Constructor } from "../http/routing/scanner/index.js";

export { FASTIFY_KIT_METADATA_SYMBOL } from "./constants/symbols.js";
export const defaultHelmetConfig = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "validator.swagger.io"],
    },
  },
};

/**
 * @description Configuración de un esquema de seguridad en OpenAPI.
 */
export interface OpenApiSecurityScheme {
  type: "http" | "apiKey" | "oauth2" | "openIdConnect";
  description?: string;
  /** Para type: "http" */
  scheme?: string;
  bearerFormat?: string;
  /** Para type: "apiKey" */
  in?: "query" | "header" | "cookie";
  name?: string;
  /** Para type: "oauth2" */
  flows?: {
    implicit?: {
      authorizationUrl: string;
      scopes: Record<string, string>;
    };
    password?: {
      tokenUrl: string;
      scopes: Record<string, string>;
    };
    clientCredentials?: {
      tokenUrl: string;
      scopes: Record<string, string>;
    };
    authorizationCode?: {
      authorizationUrl: string;
      tokenUrl: string;
      scopes: Record<string, string>;
    };
  };
  /** Para type: "openIdConnect" */
  openIdConnectUrl?: string;
}

/**
 * @description Configuración de la UI de Scalar (Fastify API Reference).
 */
export interface ScalarConfig {
  /** Tema visual de Scalar. */
  theme?:
    | "default"
    | "purple"
    | "blue"
    | "green"
    | "deepSpace"
    | "saturn"
    | "kepler"
    | "mars"
    | "none";
  /** Layout de la UI: "modern" (sidebar) o "classic" (tres columnas). */
  layout?: "modern" | "classic";
  /** Oculta el botón de descarga de spec. */
  hideDownloadButton?: boolean;
  /** Oculta los modelos/schemas al final de cada endpoint. */
  hideModels?: boolean;
  /** Oculta el botón de generación de cliente. */
  hideClientButton?: boolean;
  /** Favicon personalizado. */
  favicon?: string;
  /** CSS personalizado inyectado en la UI. */
  customCss?: string;
  /** JavaScript personalizado inyectado en la UI. */
  customJs?: string;
  /** Cliente HTTP por defecto para ejemplos de código. */
  defaultHttpClient?: "fetch" | "axios" | "node" | "curl";
  /** Configuración de autenticación en Scalar. */
  authentication?: {
    /** Security scheme preferido para el botón "Authorize". */
    preferredSecurityScheme?: string;
  };
  /** Atajo de teclado para abrir la búsqueda. */
  searchHotKey?: string;
  /** Servidores mostrados en Scalar (override de los de OpenAPI). */
  servers?: { url: string; description?: string }[];
  /** Metadata adicional para Scalar. */
  metaData?: Record<string, string>;
}

/**
 * @description Configuración completa de Swagger/OpenAPI 3.1 + Scalar UI.
 */
export interface SwaggerOptions {
  /** Título de la API. */
  title: string;
  /** Descripción de la API (soporta Markdown). */
  description: string;
  /** Versión de la API. */
  version: string;
  /** Términos de servicio URL. */
  termsOfService?: string;
  /** Información de contacto. */
  contact?: { name?: string; url?: string; email?: string };
  /** Licencia. */
  license?: { name: string; url?: string };
  /** Documentación externa. */
  externalDocs?: { description?: string; url: string };
  /** Esquemas de seguridad (bearerAuth, apiKeyAuth, oauth2, openIdConnect). */
  securitySchemes?: Record<string, OpenApiSecurityScheme>;
  /** Requisitos de seguridad globales aplicados a todos los endpoints. */
  security?: Record<string, string[]>[];
  /** Servidores (URLs) de la API para desarrollo/producción. */
  servers?: { url: string; description?: string; variables?: Record<string, any> }[];
  /** Tags globales con descripciones para agrupar endpoints en Scalar. */
  tags?: { name: string; description?: string; externalDocs?: { description?: string; url: string } }[];
  /** Configuración de la UI de Scalar. */
  scalar?: ScalarConfig;
  /** Estrategia de versionado para la API. */
  versioning?: {
    type: "path" | "header" | "servers";
    headerName?: string;
    defaultVersion?: string;
    /** Versiones de la API a documentar en OpenAPI. Cada una genera un server. */
    versions?: { version: string; description?: string }[];
  };
  /** Extensiones personalizadas (x-*). */
  [key: string]: any;
}

export interface FastifyKitOptions {
  /**
   * Modulo raiz de la app, desde donde se escanearán los controladores y proveedores
   * para registrarlos en Fastify. Este módulo debe estar decorado con el decorador
   * \@Module y es el punto de entrada para que FastifyKit descubra toda la estructura de módulos,
   * submódulos, controladores y proveedores de la aplicación.
   */
  module: Constructor;
  /**
   * Esquema de validación para las variables de entorno utilizando TypeBox.
   * Esto es util para evitar errores en tu API por falta de configuraciones en las variables de entorno
   * o por tenerlas mal configuradas (ej: un puerto como string en vez de número).
   */
  envSchema?: TSchema;
  /**
   * Prefix global para todas las rutas definidas en los controladores.
   * Ej: globalPrefix: "/api/v1" -> todas las rutas de los controladores estarán bajo /api/v1 (ej: GET /api/v1/books)
   */
  globalPrefix?: string;
  /**
   * Configuración para generar la documentación de la API utilizando Swagger/Scalar.
   * Incluye especificación OpenAPI 3.1, security schemes, UI de Scalar personalizable,
   * servers, tags globales y estrategia de versionado.
   */
  swagger?: SwaggerOptions;
  /**
   * Opciones para configurar los plugins de seguridad en Fastify,
   * incluyendo CORS, Helmet y rate limit.
   * (\@fastify/cors, \@fastify/helmet, \@fastify/rate-limit)
   */
  security?: {
    enableCors?: boolean | FastifyCorsOptions;
    enableHelmet?: boolean | FastifyHelmetOptions;
    rateLimit?: CreateRateLimitOptions;
  };
  /**
   * Activar o desactivar el soporte para multipart/form-data en el framework.
   * \(@fastify/multipart)
   */
  multipart?: boolean | "keyValues" | FastifyMultipartOptions;
  /**
   * Activar o desactivar el soporte para cookies en el framework.
   * \(@fastify/cookie)
   */
  cookies?: boolean | FastifyCookieOptions;
  /**
   * Activar o desactivar el soporte para JWT en el framework.
   * \(@fastify/jwt)
   */
  jwt?: boolean | FastifyJWTOptions;
  /**
   * Opciones avanzadas para configurar la instancia de Fastify.
   */
  fastifyOptions?: FastifyServerOptions & {
    http2?: boolean;
    https?: HttpsServerOptions | null;
  };
  /**
   * Activar o desactivar el soporte para WebSockets en el framework.
   * Recibe un boolean para activar o desactivar o un objeto de config
   * para configurar el maximo tamaño de los mensajes de WebSocket (maxPayload)
   */
  websockets?:
    | boolean
    | {
        maxPayload?: number; // Tamaño máximo de payload en bytes para mensajes de WebSocket (opcional, por defecto 10MB)
      };
  /**
   * Activar o desactivar el soporte para WebRTC en el framework.
   * Si se activa, se registrarán automáticamente los managers necesarios para usar WebRTC sin configuracion adicionaL,
   * Tambien incluye un Gateway integrado por defecto para no configurar nada adicional si solo se quiere usar WebRTC básico.
   */
  webrtc?: boolean | FastifyKitWebRtcConfig;
  /**
   * Configuracion para servir archivos estáticos.
   * Puede ser la ruta a la carpeta de archivos estaticos para servir o un obj de configuracion mas detallado
   */
  staticAssets?: string | StaticAssetsOptions;
  /**
   * Configuracion para el motor de BackgroundJobs (Integrado en el framework)
   */
  queue?: QueueOptions;
  /**
   * Configuracion para el sistema distribuido a lo largo de funciones del framework
   */
  distributed?: DistributedOptions;
}

// Aseguramos que exista Symbol.metadata para
// almacenar la metadata de los módulos, controladores y proveedores.
if (!(Symbol as any).metadata) {
  (Symbol as any).metadata = Symbol.for("Symbol.metadata");
}

export const FASTIFY_INSTANCE_TOKEN = Symbol.for("FastifyInstance");

export class FastifyKit {
  /**
   * @description Método estático para crear una instancia de Fastify configurada con FastifyKit.
   * Utiliza un pipeline de bootstrap compuesto por 7 pasos secuenciales que configuran
   * incrementalmente la aplicación: validación de entorno, creación de la instancia Fastify,
   * descubrimiento de módulos, registro de plugins, hooks de ciclo de vida y rutas,
   * y apagado elegante.
   * @param options Las opciones de configuración para FastifyKit.
   * @example
   * FastifyKit.create({
   *   module: AppModule,
   *   globalPrefix: "/api/v1",
   *   security: {
   *     enableCors: true,
   *     enableHelmet: true,
   *     rateLimit: { max: 100, timeWindow: "1 minute" }
   *   },
   *   swagger: {
   *     title: "Books API",
   *     description: "API de alto rendimiento con FastifyKit",
   *     version: "1.0.0"
   *   }
   * });
   * @returns Una instancia de Fastify configurada y lista para ser utilizada como servidor de la API.
   */
  static async create(
    options: FastifyKitOptions,
  ): Promise<FastifyInstance<any, any, any, any, TypeBoxTypeProvider>> {
    return new BootstrapPipeline(options)
      .add(new ObservabilityBootstrapStep())
      .add(new PreFlightStep())
      .add(new FastifyInstanceStep())
      .add(new ModuleDiscoveryStep())
      .add(new CorePluginsStep())
      .add(new ObservabilityInstrumentationStep())
      .add(new LifecycleAndRoutesStep())
      .add(new BootstrapHooksStep())
      .add(new GracefulShutdownStep())
      .run();
  }
}
