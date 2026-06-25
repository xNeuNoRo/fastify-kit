import type { FastifyInstance } from "fastify";
import { fastifyKitRequestContext } from "../../http/plugins/requestContext.js";
import { fastifyKitErrorHandler } from "../../http/plugins/errorHandler.js";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyJWTOptions } from "@fastify/jwt";
import {
  defaultHelmetConfig,
  FastifyKitOptions,
  type OpenApiSecurityScheme,
  type ScalarConfig,
} from "../FastifyKit.js";
import { openApiRegistry } from "../../openapi/OpenApiRegistry.js";

/**
 * @description Método privado para registrar los plugins esenciales en la instancia de Fastify, incluyendo multipart para manejo de archivos, cookies para manejo de cookies, websockets para manejo de gateways de WebSocket, plugins personalizados para manejo de contexto de solicitud y manejo de errores, plugins de seguridad (CORS, Helmet, rate limit) según las opciones proporcionadas por el usuario, y el plugin de documentación (Swagger/Scalar) si se ha configurado la opción de Swagger.
 * @param app La instancia de Fastify en la que se registrarán los plugins esenciales. Esta instancia se va a configurar con los plugins necesarios para el funcionamiento de FastifyKit, y luego se devolverá para que el usuario pueda usarla como su servidor de API.
 * @param options Las opciones de configuración para FastifyKit, que incluyen la activación de multipart, cookies, websockets, seguridad y documentación. Estas opciones se utilizan para determinar qué plugins registrar en la instancia de Fastify y con qué configuraciones específicas.
 */
export async function registerCorePlugins(
  app: FastifyInstance<any, any, any, any, TypeBoxTypeProvider>,
  options: FastifyKitOptions,
) {
  // Si el usuario activa multipart, registramos el plugin de multipart para manejar la carga de archivos en los controladores.
  if (options.multipart) {
    const multipartConfig =
      typeof options.multipart === "object" ? options.multipart : {};

    await app.register(import("@fastify/multipart"), {
      ...multipartConfig,
      attachFieldsToBody: multipartConfig.attachFieldsToBody ?? false, // Por defecto, no adjuntamos los campos al body para evitar conflictos con los decoradores de parámetros
    });
  }

  // Si el usuario activa cookies, registramos el plugin de cookies para manejar las cookies en los controladores.
  if (options.cookies) {
    const cookieConfig =
      typeof options.cookies === "object" ? options.cookies : {};
    await app.register(import("@fastify/cookie"), {
      ...cookieConfig,
    });
  }

  // Si el usuario activa JWT, registramos el plugin de JWT para manejar la autenticación basada en tokens en los controladores.
  if (options.jwt) {
    const jwtConfig =
      typeof options.jwt === "object" ? options.jwt : ({} as FastifyJWTOptions);
    await app.register(import("@fastify/jwt"), jwtConfig);
  }

  // Si el usuario activa websockets, registramos el plugin de websockets para manejar los gateways
  // de WebSocket definidos en los controladores y proveedores de los módulos.
  if (options.websockets) {
    const wsConfig =
      typeof options.websockets === "object" ? options.websockets : {};

    await app.register(import("@fastify/websocket"), {
      options: {
        maxPayload: wsConfig.maxPayload ?? 10 * 1024 * 1024, // Por defecto, 10MB
      },
    });
  }

  // Si el usuario ha configurado la opción de staticAssets, registramos el plugin de archivos estáticos.
  if (options.staticAssets) {
    const staticConfig =
      typeof options.staticAssets === "string"
        ? { root: options.staticAssets }
        : options.staticAssets;

    // Usamos 'public' como prefix por defecto si no viene uno en la configuracion
    const globalPrefix = staticConfig.prefix || "public";

    // Importamos dinamicamente el handler de archivos estáticos
    // para no cargarlo si el usuario no ha configurado la opción de staticAssets
    const { registerStaticAssetsPlugin } =
      await import("../../http/routing/scanner/static/static.handler.js");

    // Registramos el plugin globalmente pasando 'true' al final para decorateReply
    await registerStaticAssetsPlugin(
      app,
      staticConfig,
      globalPrefix,
      undefined,
      true,
    );
  } else {
    // Registramos "silenciosamente" para habilitar reply.sendFile en toda la app
    // aunque el dev no configure una carpeta global.
    await app.register(import("@fastify/static"), {
      root: process.cwd(), // Requerido por la librería aunque no se sirva
      prefix: "/fk-static-internal",
      serve: false, // Solo inyecta el decorador, no expone archivos
    });
  }

  // Registramos los plugins personalizados para manejo de contexto de solicitud y manejo de errores
  await app.register(fastifyKitRequestContext);
  await app.register(fastifyKitErrorHandler);

  // Registramos los plugins de seguridad
  await registerSecurityPlugins(app, options.security);

  // Registramos el plugin de documentación (Swagger/Scalar)
  // si el usuario ha proporcionado la configuración de Swagger en las opciones.
  await registerDocumentationPlugin(app, options);
}

/**
 * @description Método privado para registrar los plugins de seguridad (CORS, Helmet, rate limit) según las opciones proporcionadas por el usuario.
 * @param app La instancia de Fastify en la que se registrarán los plugins de seguridad. Se utiliza para llamar a app.register con cada plugin de seguridad activado en las opciones.
 * @param securityOptions Las opciones de seguridad proporcionadas por el usuario en las opciones de FastifyKit. Estas opciones pueden incluir la activación de CORS, Helmet y rate limit, así como sus configuraciones específicas. El método verifica cada una de estas opciones y registra el plugin correspondiente si están activadas.
 */
export async function registerSecurityPlugins(
  app: FastifyInstance<any, any, any, any, TypeBoxTypeProvider>,
  securityOptions?: FastifyKitOptions["security"],
) {
  // Si el usuario activa CORS, registramos el plugin de CORS
  // para permitir solicitudes desde otros orígenes según la configuración proporcionada.
  if (securityOptions?.enableCors) {
    // Si el usuario pasó un objeto de configuración para CORS, lo usamos.
    // Si solo pasó "true", usamos una configuración básica que permite cualquier origen (origin: true).
    const corsConfig =
      typeof securityOptions.enableCors === "object"
        ? securityOptions.enableCors
        : { origin: true };
    await app.register(import("@fastify/cors"), corsConfig);
  }

  // Si el usuario activa Helmet, registramos el plugin de Helmet para agregar headers de seguridad a las respuestas
  if (securityOptions?.enableHelmet) {
    // Si el usuario pasó un objeto de configuración para Helmet, lo usamos.
    const helmetConfig =
      typeof securityOptions.enableHelmet === "object"
        ? securityOptions.enableHelmet
        : defaultHelmetConfig;

    await app.register(import("@fastify/helmet"), helmetConfig);
  }

  // Si el usuario activa rate limit, registramos el plugin de rate limit para limitar la cantidad de peticiones por IP y evitar abusos
  if (securityOptions?.rateLimit) {
    await app.register(import("@fastify/rate-limit"), {
      ...securityOptions.rateLimit,
    });
  }
}

/**
 * @description Método privado para registrar el plugin de documentación (Swagger/Scalar) si el usuario ha proporcionado la configuración de Swagger en las opciones.
 * @param app La instancia de Fastify en la que se registrará el plugin de documentación. Se utiliza para llamar a app.register con el plugin de Swagger y Scalar si se ha configurado.
 * @param options Las opciones de configuración para FastifyKit, que incluyen la configuración de Swagger en la propiedad "swagger". Si esta propiedad está presente, se registrará el plugin de documentación.
 */
export async function registerDocumentationPlugin(
  app: FastifyInstance<any, any, any, any, TypeBoxTypeProvider>,
  options: FastifyKitOptions,
) {
  // Si el usuario activa Swagger/Scalar, registramos el plugin de Scalar para generar una documentación interactiva y visualmente atractiva de la API en la ruta /docs
  if (options.swagger) {
    // Recolectamos los schemas registrados via @ApiSchema y @ApiProperty
    const componentsSchemas = openApiRegistry.getComponentsSchemas();

    // Auto-detectar security schemes si no se definieron explicitamente
    const securitySchemes: Record<string, OpenApiSecurityScheme> = {
      ...(options.swagger.securitySchemes || {}),
    };

    // Si el usuario activo JWT y no definio bearerAuth, lo registramos automaticamente
    if (options.jwt && !securitySchemes.bearerAuth) {
      securitySchemes.bearerAuth = {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Token JWT obtenido del endpoint de autenticacion",
      };
    }

    // Generamos servers basados en versioning si esta configurado y no hay servers explicitos
    let servers = options.swagger.servers || [];
    if (
      !servers.length &&
      options.swagger.versioning?.type === "path" &&
      options.swagger.versioning?.versions?.length
    ) {
      servers = options.swagger.versioning.versions.map((v) => ({
        url: `/v${v.version}`,
        description: v.description || `API v${v.version}`,
      }));
    }

    await app.register(import("@fastify/swagger"), {
      openapi: {
        openapi: "3.1.0",
        info: options.swagger,
        components: {
          ...(Object.keys(securitySchemes).length
            ? { securitySchemes }
            : {}),
          ...(Object.keys(componentsSchemas).length
            ? { schemas: componentsSchemas }
            : {}),
        } as Record<string, unknown>,
        ...(options.swagger.security
          ? { security: options.swagger.security }
          : {}),
        ...(servers.length ? { servers } : {}),
        ...(options.swagger.tags ? { tags: options.swagger.tags } : {}),
        ...(options.swagger.externalDocs
          ? { externalDocs: options.swagger.externalDocs }
          : {}),
      },
    });
    // Configuramos Scalar con las opciones del usuario (solo las definidas)
    const scalarConfig: Record<string, unknown> = {
      theme: options.swagger.scalar?.theme ?? "purple",
      layout: options.swagger.scalar?.layout ?? "modern",
      hideDownloadButton: options.swagger.scalar?.hideDownloadButton ?? false,
      hideModels: options.swagger.scalar?.hideModels ?? false,
      hideClientButton: options.swagger.scalar?.hideClientButton ?? false,
      metaData: {
        title: options.swagger.title,
        ...(options.swagger.scalar?.metaData || {}),
      },
    };

    // Solo agregamos propiedades opcionales si estan definidas
    if (options.swagger.scalar?.favicon) {
      scalarConfig.favicon = options.swagger.scalar.favicon;
    }
    if (options.swagger.scalar?.customCss) {
      scalarConfig.customCss = options.swagger.scalar.customCss;
    }
    if (options.swagger.scalar?.customJs) {
      scalarConfig.customJs = options.swagger.scalar.customJs;
    }
    if (options.swagger.scalar?.defaultHttpClient) {
      scalarConfig.defaultHttpClient = options.swagger.scalar.defaultHttpClient;
    }
    if (options.swagger.scalar?.authentication) {
      scalarConfig.authentication = options.swagger.scalar.authentication;
    }
    if (options.swagger.scalar?.searchHotKey) {
      scalarConfig.searchHotKey = options.swagger.scalar.searchHotKey;
    }
    if (options.swagger.scalar?.servers?.length) {
      scalarConfig.servers = options.swagger.scalar.servers;
    }

    await app.register(import("@scalar/fastify-api-reference"), {
      routePrefix: "/docs",
      configuration: scalarConfig,
    });
  }
}
