import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { container } from "../../../container/DIContainer.js";
import { ForbiddenException } from "../../exceptions/SecurityExceptions.js";
import { ApiResponse } from "../../responses/ApiResponse.js";
import { getLogger } from "../../../logger/logger.factory.js";
import { extractArguments } from "./parameter.resolver.js";
import { FastifyKitMetadata } from "../../decorators/types.js";
import { getGlobalMaxFileSize } from "./multipart.handler.js";
import type {
  ExecutionContext,
  Interceptor,
} from "../../interceptors/Interceptor.js";
import { executeInterceptors } from "../../interceptors/interceptor.executor.js";
import { StaticFile } from "../../responses/StaticFile.js";
import {
  handleStaticFileResponse,
  registerStaticAssetsPlugin,
} from "./static/static.handler.js";

export type Constructor<T = any> = new (...args: any[]) => T;

// Usamos un símbolo único para almacenar la metadata de los decoradores en las clases
// y métodos de los controladores, evitando así conflictos con otras propiedades o símbolos que puedan existir en el futuro.
const metadataSymbol: symbol =
  (Symbol as any).metadata ?? Symbol.for("Symbol.metadata");

/**
 * @description Construye y normaliza la ruta final a registrar en Fastify.
 */
function buildRoutePath(
  version: unknown,
  prefix: string,
  routePath: string,
): string {
  const versionPrefix =
    version && (typeof version === "number" || typeof version === "string")
      ? `/v${version}`
      : "";

  // Construimos la ruta completa combinando el prefijo del controlador,
  // el path de la ruta y la versión (si se definió).
  // Normalizamos la ruta para evitar problemas con múltiples slashes o slashes al final.
  let fullPath = `/${versionPrefix}/${prefix}/${routePath}`
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");

  return fullPath === "" ? "/" : fullPath;
}

/**
 * @description Crea el preHandler de Fastify para la ejecución de Guards.
 */
function buildGuardHandler(guards: Constructor[]) {
  if (guards.length === 0) return undefined;

  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Para cada guard definido para esta ruta, resolvemos su instancia desde el contenedor de inyección de dependencias y llamamos a su método canActivate pasando el request y reply. Si algún guard devuelve false, lanzamos una excepción de acceso denegado.
    for (const GuardClass of guards) {
      const guardInstance = container.resolve(GuardClass);
      const canActivate = await guardInstance.canActivate(request, reply);
      if (!canActivate) {
        // El Guard falló. Cortamos la petición lanzando tu error estandarizado.
        throw new ForbiddenException("Acceso denegado a este recurso.");
      }
    }
  };
}

/**
 * @description Formatea la respuesta devuelta por el método del controlador.
 */
function formatResponse(result: any, reply: FastifyReply) {
  if (reply.sent) return;

  if (result === reply) return;

  if (result instanceof ApiResponse) return result;

  if (result instanceof StaticFile) {
    return handleStaticFileResponse(result, reply);
  }

  return ApiResponse.success(result);
}

/**
 * @description Escanea y registra todos los controladores en la instancia de Fastify.
 */
export function registerControllers(
  app: FastifyInstance,
  controllers: Constructor[],
) {
  // Iteramos sobre cada controlador registrado
  for (const ControllerClass of controllers) {
    const metadata = (ControllerClass as any)[
      metadataSymbol
    ] as FastifyKitMetadata;

    // Si no se encuentran rutas en el contexto de este controlador
    // Registramos una advertencia en los logs indicando que no se
    // encontraron rutas para este controlador
    if (!metadata?.routes) {
      getLogger().warn(
        `[FastifyKit Scanner] No se encontraron rutas en ${ControllerClass.name}`,
      );
      continue;
    }

    // Obtenemos la instancia del controlador desde el contenedor de inyección de dependencias
    const instance = container.resolve(ControllerClass);

    // Si se encuentran rutas, extraemos el prefijo y las rutas del metadata
    const prefix = metadata.prefix || "";
    const routes = metadata.routes;

    // Obtenemos los guards definidos a nivel de clase para este controlador desde la metadata
    const classGuards = metadata.classGuards || [];
    // Obtenemos los interceptors definidos a nivel de clase para este controlador desde la metadata
    const classInterceptors = metadata.classInterceptors || [];

    // Si se han configurado archivos estáticos para este controlador, 
    // registramos el plugin de archivos estáticos en la instancia de Fastify aplicando 
    // las opciones configuradas y un guard personalizado que combina los guards definidos 
    // a nivel de clase para proteger las rutas de archivos estáticos.
    if (metadata.staticAssets) {
      const guardHandler = buildGuardHandler(classGuards);
      // Fastify encola el app.register internamente, por lo que no necesitamos await aquí
      registerStaticAssetsPlugin(
        app,
        metadata.staticAssets,
        prefix,
        guardHandler,
      );
    }

    // Iteramos sobre cada ruta definida en el controlador y la registramos en Fastify
    for (const route of routes) {
      // Obtenemos la metadata de los parámetros decorados para el método del controlador correspondiente a esta ruta.
      // Ordenamos los parámetros decorados por su índice para asegurarnos de que se pasen en el
      // orden correcto al método del controlador.
      const rawParamsMeta = metadata.parameters?.[route.handlerName] || [];
      const methodParamsMeta = [...rawParamsMeta].sort((a, b) => {
        const isAStream = a.type === "file" && a.fileOptions?.mode === "stream";
        const isBStream = b.type === "file" && b.fileOptions?.mode === "stream";
        if (isAStream && !isBStream) return -1;
        if (!isAStream && isBStream) return 1;
        return a.index - b.index;
      });

      const hasFiles = methodParamsMeta.some((p) => p.type === "file");
      const hasStreamFiles = methodParamsMeta.some(
        (p) => p.type === "file" && p.fileOptions?.mode === "stream",
      );
      const globalMaxSize = hasFiles
        ? getGlobalMaxFileSize(methodParamsMeta)
        : undefined;

      // Obtenemos los guards definidos a nivel de método para esta ruta desde el metadata
      const routeGuards = metadata.routeGuards?.[route.handlerName] || [];

      // Combinamos: Primero los de la clase, luego los del método
      const allGuards = [...classGuards, ...routeGuards];

      // Obtenemos los interceptors definidos a nivel de método para esta ruta desde el metadata
      const routeInterceptors =
        metadata.routeInterceptors?.[route.handlerName] || [];
      const allInterceptorClasses = [
        ...classInterceptors,
        ...routeInterceptors,
      ];
      // Resolvemos las instancias de los interceptors desde el contenedor de inyección de dependencias
      const resolvedInterceptors = allInterceptorClasses.map(
        (InterceptorClass) => container.resolve<Interceptor>(InterceptorClass),
      );

      // Construimos la ruta completa combinando el prefijo del controlador, el path de la ruta y la versión (si se definió), utilizando la función buildRoutePath.
      const routeVersion =
        metadata.methodVersions?.[route.handlerName] || metadata.version;
      const fullPath = buildRoutePath(routeVersion, prefix, route.path);

      // Obtenemos la configuración de rate limiting para esta ruta desde el metadata
      const rateLimitConfig = metadata.rateLimits?.[route.handlerName];

      // Obtenemos el esquema de respuesta para esta ruta desde el metadata
      const methodResponses = metadata.responsesSchema?.[route.handlerName];

      // Registramos la ruta en Fastify utilizando el método HTTP especificado en el decorador de la ruta (route.method), la ruta completa construida con el prefijo y la ruta, el esquema de validación (si se proporcionó) y el preHandler para validar los guards antes de ejecutar el controlador.
      app[route.method](
        fullPath,
        {
          schema: methodResponses
            ? {
                ...(route.schema || {}),
                response: {
                  ...((route.schema?.response as any) || {}),
                  ...methodResponses,
                },
              }
            : route.schema,
          // Solo lo inyectamos si hay guards para evitar overhead
          preHandler: buildGuardHandler(allGuards),
          // Solo lo inyectamos si hay configuración de rate limit para evitar overhead
          ...(rateLimitConfig
            ? {
                config: {
                  rateLimit: rateLimitConfig,
                },
              }
            : {}),
        },
        async (request, reply) => {
          const executeController = async () => {
            // Si no hay decoradores de parámetros, mantenemos compatibilidad pasandole (req, reply) directamente al método del controlador
            if (methodParamsMeta.length === 0) {
              return await instance[route.handlerName](request, reply);
            }

            // Si hay decoradores de parámetros, extraemos los argumentos a pasar al método del controlador según los decoradores de parámetros definidos en el método del controlador y luego llamamos al método del controlador pasando esos argumentos.
            const args = await extractArguments(
              request,
              reply,
              methodParamsMeta,
              hasFiles,
              hasStreamFiles,
              globalMaxSize,
            );
            // Llamamos al método del controlador correspondiente a esta ruta pasando los argumentos extraídos de la request y reply según los decoradores de parámetros definidos en el método del controlador
            return await instance[route.handlerName](...args);
          };

          let result: unknown;

          // Si no hay interceptores, ejecutamos el controlador directamente
          // De esa forma evitamos overhead innecesario ya que no existe flujo de interceptores como tal para esta ruta.
          if (resolvedInterceptors.length === 0) {
            result = await executeController();
          } else {
            // Si hay interceptores, construimos un flujo de ejecución de interceptores donde cada interceptor llama al siguiente en la cadena hasta llegar a la ejecución del controlador.
            const context: ExecutionContext = {
              request,
              reply,
            };
            result = await executeInterceptors(
              context, // Le pasamos el contexto de la request y reply
              resolvedInterceptors, // Los interceptores definidos de la ruta
              executeController, // Y el finalHandler que seria el controlador
            );
          }

          // Formateamos la respuesta devuelta por el método del controlador para enviarla al cliente utilizando la función formatResponse, que se encarga de verificar si el controlador ya ha enviado una respuesta o si el resultado devuelto es una instancia de ApiResponse, y formatea la respuesta de manera consistente.
          return formatResponse(result, reply);
        },
      );
    }
  }
}
