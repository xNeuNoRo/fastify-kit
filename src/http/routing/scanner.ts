import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { container } from "../../container/DIContainer.js";
import {
  ForbiddenException,
  BadRequestException,
  UnsupportedMediaTypeException,
  FileTooLargeException,
} from "../exceptions/index.js";
import type { FastifyKitMetadata } from "../decorators/types.js";
import { ApiResponse } from "../responses/ApiResponse.js";
import type { PipeTransform } from "../pipes/PipeTransform.js";
import { getLogger } from "../../logger/logger.factory.js";

export type Constructor<T = any> = new (...args: any[]) => T;

// Usamos un símbolo único para almacenar la metadata de los decoradores en las clases
// y métodos de los controladores, evitando así conflictos con otras propiedades o símbolos que puedan existir en el futuro.
const metadataSymbol: symbol =
  (Symbol as any).metadata ?? Symbol.for("Symbol.metadata");

/**
 * @description Construye y normaliza la ruta final a registrar en Fastify.
 * @param version Versión de la ruta (opcional).
 * @param prefix Prefijo definido a nivel de controlador (opcional).
 * @param routePath Path definido en el decorador de la ruta.
 * @returns Ruta completa y normalizada para registrar en Fastify.
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
 * Retorna undefined si no hay guards para evitar overhead en Fastify.
 * @param guards Array de clases de Guards a ejecutar para esta ruta.
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
 * @description Función genérica para resolver el valor de un parámetro decorado según su tipo
 * (body, query, param, headers, request, reply, ip) a partir del objeto request o reply de Fastify.
 * @param param Metadata del parámetro decorado, que incluye su tipo (body, query, param, headers, request, reply, ip) y una clave opcional para extraer un valor específico de ese tipo.
 * @param request Objeto FastifyRequest de la ruta, que contiene la información de la solicitud HTTP realizada por el cliente.
 * @param reply Objeto FastifyReply de la ruta, que se utiliza para enviar la respuesta al cliente.
 * @returns El valor resuelto del parámetro decorado según su tipo, que puede ser el body, query, param, headers, request, reply o ip extraído del objeto request o reply de Fastify.
 */
async function resolveParamValue(
  param: any,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<any> {
  // Dependiendo del tipo de parámetro definido en la metadata del decorador,
  // extraemos su valor correspondiente del request o reply de Fastify.
  // Si el decorador de este parámetro tiene una clave definida (param.key),
  // extraemos solo esa clave específica del objeto correspondiente (por ejemplo, request.body[param.key]
  // o request.query[param.key]). Si no tiene una clave definida, extraemos
  // el objeto correspondiente (por ejemplo, request.body o request.query).
  switch (param.type) {
    case "body":
      return param.key ? (request.body as any)?.[param.key] : request.body;
    case "query":
      return param.key ? (request.query as any)?.[param.key] : request.query;
    case "param":
      return param.key ? (request.params as any)?.[param.key] : request.params;
    case "headers":
      return param.key
        ? request.headers[param.key.toLowerCase()]
        : request.headers;
    case "request":
      return request;
    case "reply":
      return reply;
    case "ip":
      return request.ip;
    case "file": {
      // Si la peticion no es multipart, lanzamos un error indicando que se esperaba una petición multipart/form-data para procesar archivos.
      if (typeof request.isMultipart !== "function" || !request.isMultipart()) {
        throw new BadRequestException(
          "La petición debe ser 'multipart/form-data' para procesar archivos.",
        );
      }

      // Extraemos las opciones específicas para el manejo de archivos desde la metadata del decorador
      const options = param.fileOptions || {};
      const maxSize = options.maxSize;
      const mimetypes = options.mimetypes;
      const mode = options.mode || "buffer";

      if (mode === "buffer") {
        const fileData = (request as any)._filesMap?.get(param.key);

        // Si no se encuentra un archivo o no se encuentra en el campo especificado, lanzamos un error
        if (!fileData) {
          throw new BadRequestException(
            `Falta el archivo requerido en el campo '${param.key}'.`,
          );
        }

        // Validamos los mimes permitidos por el dev
        if (
          mimetypes &&
          mimetypes.length > 0 &&
          !mimetypes.includes(fileData.mimetype)
        ) {
          throw new UnsupportedMediaTypeException(fileData.mimetype);
        }

        // Retornamos un objeto con la información del archivo, incluyendo su nombre original, tipo MIME, codificación y el buffer del archivo para que el controlador pueda procesarlo.
        return fileData;
      }

      if (mode === "stream") {
        try {
          for await (const part of request.parts({
            limits: { fileSize: options.maxSize },
          })) {
            if (part.type === "file" && part.fieldname === param.key) {
              // Validamos los mimes permitidos por el dev
              if (
                mimetypes &&
                mimetypes.length > 0 &&
                !mimetypes.includes(part.mimetype)
              ) {
                throw new UnsupportedMediaTypeException(part.mimetype);
              }

              // Retornamos un objeto con la información del archivo, incluyendo su nombre original, tipo MIME, codificación y el stream del archivo para que el controlador pueda procesarlo sin cargarlo completamente en memoria.
              return {
                filename: part.filename,
                mimetype: part.mimetype,
                encoding: part.encoding,
                stream: part.file, // Entregamos el stream intacto
              };
            } else if (part.type === "file") {
              // Descartamos/drenamos los archivos que no coinciden para evitar colapso de RAM
              part.file.resume();
            }
          }

          // Si llegamos hasta aquí, significa que no se encontró un archivo en el campo especificado, por lo que lanzamos un error indicando que falta el archivo requerido.
          throw new BadRequestException(
            `Falta el archivo requerido en el campo '${param.key}'.`,
          );
        } catch (error: any) {
          // Si Fastify lanza un error con el código "FST_REQ_FILE_TOO_LARGE", significa que el archivo excedió el tamaño máximo permitido.
          if (error.code === "FST_REQ_FILE_TOO_LARGE") {
            throw new FileTooLargeException(
              options.maxSize
                ? `${(options.maxSize / 1024 / 1024).toFixed(2)}MB`
                : "permitido",
            );
          }

          // Propagamos cualquier otro error
          throw error;
        }
      }
      break;
    }
    default:
      // Opcional: Lanza un error o devuelve undefined si el tipo no es soportado
      return undefined;
  }
}

/**
 * @description Extrae los argumentos a pasar al método del controlador según los decoradores de parámetros definidos en el método del controlador.
 * @param request Objeto FastifyRequest de la ruta.
 * @param reply Objeto FastifyReply de la ruta.
 * @param methodParamsMeta Metadata de los parámetros decorados para el método del controlador correspondiente a esta ruta.
 * @returns Array de argumentos a pasar al método del controlador en el orden correcto según su índice definido en los decoradores de parámetros.
 */
async function extractArguments(
  request: FastifyRequest,
  reply: FastifyReply,
  methodParamsMeta: any[],
): Promise<any[]> {
  // Creamos un array de argumentos que se pasará al método del controlador,
  // donde cada posición corresponde al índice definido en los decoradores de parámetros.
  const args: any[] = [];

  // Iteramos sobre cada parámetro decorado y extraemos su valor del request o reply según el tipo de parámetro definido en la metadata del decorador
  for (const param of methodParamsMeta) {
    let value = await resolveParamValue(param, request, reply);

    // Si el decorador de este parámetro tiene un pipe definido,
    // resolvemos su instancia desde el contenedor de inyección de dependencias
    // y llamamos a su método transform pasando el valor extraído.
    // El resultado transformado se asigna como valor final del argumento que se pasará al método del controlador.
    if (param.pipe) {
      const pipeInstance = container.resolve<PipeTransform>(param.pipe);
      value = await pipeInstance.transform(value);
    }

    args[param.index] = value;
  }

  return args;
}

/**
 * @description Formatea la respuesta devuelta por el método del controlador para enviarla al cliente. Si el controlador ya ha enviado una respuesta usando reply.send(), no hace nada. Si el resultado devuelto por el controlador es una instancia de ApiResponse, lo retorna tal cual para que Fastify lo envíe como respuesta. Si el resultado no es una instancia de ApiResponse, lo envuelve en un ApiResponse.success() para enviar una respuesta con formato consistente.
 * @param result Resultado devuelto por el método del controlador después de ejecutarse. Puede ser cualquier tipo de dato, pero si no es una instancia de ApiResponse, se asumirá que es el payload de una respuesta exitosa y se envolverá en un ApiResponse.success().
 * @param request Objeto FastifyRequest de la ruta.
 * @param reply Objeto FastifyReply de la ruta.
 * @returns Respuesta formateada para enviar al cliente, que puede ser una instancia de ApiResponse o el resultado devuelto por el controlador envuelto en un ApiResponse.success().
 */
function formatResponse(result: any, reply: FastifyReply) {
  // Si el controlador ya ha enviado una respuesta (por ejemplo, usando reply.send()),
  // no hacemos nada más para evitar errores de "Headers already sent".
  if (reply.sent) {
    return;
  }

  // Si el resultado devuelto por el controlador es una instancia de ApiResponse,
  // simplemente lo retornamos y ya que Fastify se encargará de serializarlo y enviarlo como respuesta.
  if (result instanceof ApiResponse) {
    return result;
  }

  // Si llego hasta aqui quiere decir que no hubo error, pero el controlador tampoco devolvió una respuesta válida.
  // Para evitar que la petición quede colgada, enviamos una respuesta por defecto
  // con ApiResponse 200 y el resultado devuelto por el controlador como payload.
  return ApiResponse.success(result);
}

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

    // Obtenemos los guards definidos a nivel de clase para este controlador desde el metadata
    const classGuards = metadata.classGuards || [];

    // Iteramos sobre cada ruta definida en el controlador y la registramos en Fastify
    for (const route of routes) {
      // Obtenemos la metadata de los parámetros decorados para el método del controlador correspondiente a esta ruta.
      // Ordenamos los parámetros decorados por su índice para asegurarnos de que se pasen en el
      // orden correcto al método del controlador.
      const rawParamsMeta = metadata.parameters?.[route.handlerName] || [];
      const methodParamsMeta = [...rawParamsMeta].sort(
        (a, b) => a.index - b.index,
      );

      // Obtenemos los guards definidos a nivel de método para esta ruta desde el metadata
      const routeGuards = metadata.routeGuards?.[route.handlerName] || [];

      // Combinamos: Primero los de la clase, luego los del método
      const allGuards = [...classGuards, ...routeGuards];

      // Construimos la ruta completa combinando el prefijo del controlador, el path de la ruta y la versión (si se definió), utilizando la función buildRoutePath.
      const routeVersion =
        metadata.methodVersions?.[route.handlerName] || metadata.version;
      const fullPath = buildRoutePath(routeVersion, prefix, route.path);

      // Obtenemos la configuración de rate limiting para esta ruta desde el metadata
      const rateLimitConfig = metadata.rateLimits?.[route.handlerName];

      // Registramos la ruta en Fastify utilizando el método HTTP especificado en el decorador de la ruta (route.method), la ruta completa construida con el prefijo y la ruta, el esquema de validación (si se proporcionó) y el preHandler para validar los guards antes de ejecutar el controlador.
      app[route.method](
        fullPath,
        {
          schema: route.schema,
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
          let result;

          // Si no hay decoradores de parámetros, mantenemos compatibilidad pasandole (req, reply) directamente al método del controlador
          if (methodParamsMeta.length === 0) {
            result = await instance[route.handlerName](request, reply);
          }
          // Si hay decoradores de parámetros, extraemos los argumentos a pasar al método del controlador según los decoradores de parámetros definidos en el método del controlador y luego llamamos al método del controlador pasando esos argumentos.
          else {
            const args = await extractArguments(
              request,
              reply,
              methodParamsMeta,
            );
            // Llamamos al método del controlador correspondiente a esta ruta pasando los argumentos extraídos de la request y reply según los decoradores de parámetros definidos en el método del controlador
            result = await instance[route.handlerName](...args);
          }

          // Formateamos la respuesta devuelta por el método del controlador para enviarla al cliente utilizando la función formatResponse, que se encarga de verificar si el controlador ya ha enviado una respuesta o si el resultado devuelto es una instancia de ApiResponse, y formatea la respuesta de manera consistente.
          return formatResponse(result, reply);
        },
      );
    }
  }
}
