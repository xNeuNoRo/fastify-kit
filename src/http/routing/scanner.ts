import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { container } from "../../container/DIContainer.js";
import {
  ForbiddenException,
  BadRequestException,
  UnsupportedMediaTypeException,
  FileTooLargeException,
  InternalServerException,
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
 * @description Formatea el tamaño máximo permitido para archivos en un mensaje legible para humanos, convirtiendo bytes a megabytes con dos decimales. Si no se define un tamaño máximo, retorna "permitido" para indicar que no hay límite.
 * @param maxSize Tamaño máximo permitido para archivos en bytes, definido en las opciones del decorador @File(). Es un valor opcional, por lo que puede ser undefined si no se definió un límite de tamaño.
 * @returns Cadena de texto que representa el tamaño máximo permitido para archivos en un formato legible para humanos, por ejemplo "5.00MB". Si no se definió un tamaño máximo, retorna "permitido".
 */
function formatFileSizeLimit(maxSize?: number): string {
  return maxSize ? `${(maxSize / 1024 / 1024).toFixed(2)}MB` : "permitido";
}

/**
 * @description Verifica si la petición es multipart/form-data y si aún no se ha precargado, y también verifica si la ruta exige algún archivo en modo "stream" para decidir si se precarga el formulario multipart en memoria o no. Si la petición no es multipart, ya se ha precargado o la ruta exige archivos en modo "stream", retorna false para indicar que no es necesario precargar el formulario multipart en memoria. Si la petición es multipart, no se ha precargado y la ruta no exige archivos en modo "stream", retorna true para indicar que se debe precargar el formulario multipart en memoria.
 * @param request Objeto FastifyRequest de la ruta, que contiene la información de la solicitud HTTP realizada por el cliente, incluyendo los archivos enviados en un formulario multipart/form-data.
 * @param methodParamsMeta Metadata de los parámetros decorados para el método del controlador correspondiente a esta ruta, que se utiliza para verificar si la ruta exige algún archivo en modo "stream" y así decidir si se precargan los archivos en memoria para evitar problemas de rendimiento.
 * @returns Booleano que indica si se debe precargar el formulario multipart en memoria (true) o no (false) según las condiciones mencionadas.
 */
function shouldPreparseMultipart(
  request: FastifyRequest,
  methodParamsMeta: any[],
): boolean {
  if (typeof request.isMultipart !== "function" || !request.isMultipart()) {
    return false;
  }

  if ((request as any)._multipartParsed) {
    return false;
  }

  // Si el body ya tiene alguna propiedad que parece un archivo
  // (tiene una propiedad "filename"), asumimos que el formulario multipart ya
  // fue precargado en memoria por alguna razón (por ejemplo, por otro middleware o plugin)
  // y no intentamos precargarlo nuevamente para evitar problemas de rendimiento o conflictos.
  const body = request.body as any;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const values = Object.values(body);
    const alreadyParsed = values.some(
      (v: any) =>
        (v && typeof v === "object" && "filename" in v) ||
        (Array.isArray(v) &&
          v[0] &&
          typeof v[0] === "object" &&
          "filename" in v[0]),
    );
    if (alreadyParsed) return false;
  }

  return !methodParamsMeta.some(
    (p) => p.type === "file" && p.fileOptions?.mode === "stream",
  );
}

/**
 * @description Inicializa las propiedades necesarias en el objeto request para almacenar los archivos precargados en memoria al procesar un formulario multipart/form-data. Agrega un mapa vacío para almacenar los archivos precargados y marca la petición como multipart ya parseada para evitar que se vuelva a precargar si se llama esta función nuevamente.
 * @param request Objeto FastifyRequest de la ruta, que contiene la información de la solicitud HTTP realizada por el cliente, incluyendo los archivos enviados en un formulario multipart/form-data. Esta función modifica el objeto request agregando propiedades para almacenar los archivos precargados en memoria.
 */
function initializeMultipartRequest(request: FastifyRequest): void {
  (request as any)._multipartParsed = true;
  (request as any)._filesMap = new Map();
  request.body = request.body || {};
}

/**
 * @description Obtiene el tamaño máximo permitido para archivos definido en las opciones de los decoradores @File() de los parámetros del método del controlador. Si se definen múltiples decoradores @File() con maxSize, retorna el valor máximo entre ellos para aplicar un límite global al precargar el formulario multipart en memoria y proteger la memoria. Si no se define ningún maxSize en los decoradores @File(), retorna undefined para indicar que no hay límite de tamaño.
 * @param methodParamsMeta Metadata de los parámetros decorados para el método del controlador correspondiente a esta ruta, que se utiliza para extraer las opciones de los decoradores @File() y obtener el tamaño máximo permitido para archivos definido en esas opciones.
 * @returns El tamaño máximo permitido para archivos en bytes definido en las opciones de los decoradores @File() de los parámetros del método del controlador. Si se definen múltiples maxSize, retorna el valor máximo entre ellos. Si no se define ningún maxSize, retorna undefined para indicar que no hay límite de tamaño.
 */
function getGlobalMaxFileSize(methodParamsMeta: any[]): number | undefined {
  const maxSizes = methodParamsMeta
    .filter((p) => p.type === "file" && p.fileOptions?.maxSize)
    .map((p) => p.fileOptions!.maxSize!);

  return maxSizes.length > 0 ? Math.max(...maxSizes) : undefined;
}

/**
 * @description Mapea los errores lanzados por Fastify al procesar un formulario multipart/form-data, específicamente el error de límite de tamaño de archivo, para lanzar nuestra excepción personalizada FileTooLargeException con un mensaje que incluye el tamaño máximo permitido definido en las opciones del decorador @File() (si se definió). Si el error no es un error de límite de tamaño de archivo, lo relanza sin modificarlo.
 * @param error Error lanzado por Fastify al procesar un formulario multipart/form-data, que puede ser un error de límite de tamaño de archivo u otro tipo de error.
 * @param maxSize Tamaño máximo permitido para archivos en bytes definido en las opciones de los decoradores @File() de los parámetros del método del controlador, que se utiliza para formatear el mensaje de la excepción FileTooLargeException si el error es un error de límite de tamaño de archivo. Es un valor opcional, por lo que puede ser undefined si no se definió un límite de tamaño.
 */
function mapMultipartSizeError(error: any, maxSize?: number): never {
  if (error.code === "FST_REQ_FILE_TOO_LARGE") {
    throw new FileTooLargeException(formatFileSizeLimit(maxSize));
  }

  throw error;
}

/**
 * @description Maneja cada parte del formulario multipart/form-data que corresponde a un archivo, precargando su contenido en memoria como un buffer y almacenándolo en un mapa dentro del objeto request para que pueda ser accedido posteriormente por resolveMultipartFile. También verifica si el archivo fue truncado por exceder el tamaño máximo permitido definido en las opciones del decorador @File() y lanza una excepción de FileTooLargeException si es así.
 * @param request Objeto FastifyRequest de la ruta, que contiene la información de la solicitud HTTP realizada por el cliente, incluyendo los archivos enviados en un formulario multipart/form-data. Esta función modifica el objeto request agregando los archivos precargados en memoria a un mapa para que puedan ser accedidos posteriormente por resolveMultipartFile.
 * @param part Objeto que representa una parte del formulario multipart/form-data que corresponde a un archivo, que incluye información como el nombre del campo (fieldname), el nombre del archivo (filename), el tipo MIME (mimetype), la codificación (encoding) y un método toBuffer() para obtener el contenido del archivo como un buffer. Este objeto es proporcionado por Fastify al iterar sobre las partes del formulario multipart utilizando request.parts().
 * @param globalMaxSize Tamaño máximo permitido para archivos en bytes definido en las opciones de los decoradores @File() de los parámetros del método del controlador, que se utiliza para verificar si el archivo fue truncado por exceder este tamaño máximo y lanzar una excepción de FileTooLargeException si es así. Es un valor opcional, por lo que puede ser undefined si no se definió un límite de tamaño.
 */
async function handleMultipartFilePart(
  request: FastifyRequest,
  part: any,
  globalMaxSize?: number,
): Promise<void> {
  const buffer = await part.toBuffer();

  if (part.file.truncated) {
    throw new FileTooLargeException(formatFileSizeLimit(globalMaxSize));
  }

  (request as any)._filesMap.set(part.fieldname, {
    filename: part.filename,
    mimetype: part.mimetype,
    encoding: part.encoding,
    buffer,
  });
}

/**
 * @description Pre-parsea el formulario multipart/form-data en memoria para extraer los archivos y almacenarlos en un mapa dentro del objeto request, pero solo si la petición es multipart/form-data, aún no se ha precargado y la ruta no exige archivos en modo "stream". Esto se hace para mejorar el rendimiento al acceder a los archivos desde resolveMultipartFile sin tener que procesar el formulario multipart cada vez que se accede a un archivo. Si la petición no es multipart, ya se ha precargado o la ruta exige archivos en modo "stream", esta función no hace nada.
 * @param request Objeto FastifyRequest de la ruta, que contiene la información de la solicitud HTTP realizada por el cliente, incluyendo los archivos enviados en un formulario multipart/form-data. Esta función modifica el objeto request agregando los archivos precargados en memoria a un mapa para que puedan ser accedidos posteriormente por resolveMultipartFile, pero solo si se cumplen las condiciones mencionadas.
 * @param methodParamsMeta Metadata de los parámetros decorados para el método del controlador correspondiente a esta ruta, que se utiliza para verificar si la ruta exige algún archivo en modo "stream" y así decidir si se precargan los archivos en memoria para evitar problemas de rendimiento. Si la ruta exige archivos en modo "stream", esta función no hace nada.
 * @returns Una promesa que se resuelve cuando se ha terminado de pre-parcear el formulario multipart en memoria, o inmediatamente si no es necesario pre-parcear según las condiciones mencionadas.
 */
async function preparseMultipartFormData(
  request: FastifyRequest,
  methodParamsMeta: any[],
): Promise<void> {
  if (!shouldPreparseMultipart(request, methodParamsMeta)) {
    return;
  }

  // Si por alguna razon el stream ya esta cerrado, no intentamos preparsear para evitar errores.
  if (request?.raw?.readableEnded) return;

  initializeMultipartRequest(request);

  const globalMaxSize = getGlobalMaxFileSize(methodParamsMeta);
  const partsOptions = globalMaxSize
    ? { limits: { fileSize: globalMaxSize } }
    : {};

  try {
    for await (const part of request.parts(partsOptions)) {
      if (part.type === "file") {
        await handleMultipartFilePart(request, part, globalMaxSize);
        continue;
      }

      (request.body as any)[part.fieldname] = part.value;
    }
  } catch (error: any) {
    mapMultipartSizeError(error, globalMaxSize);
  }
}

/**
 * @description Resuelve el valor de un parámetro decorado con @File() extrayendo el archivo del request multipart/form-data. Soporta dos modos: "buffer" para cargar el archivo completo en memoria como un buffer, y "stream" para devolver un stream de lectura del archivo sin cargarlo completamente en memoria. También valida el tipo MIME y el tamaño máximo del archivo según las opciones definidas en el decorador.
 * @param param Metadata del parámetro decorado con @File(), que incluye la clave para extraer el archivo del request, las opciones de validación como maxSize y mimetypes, y el modo de procesamiento (buffer o stream).
 * @param request Objeto FastifyRequest de la ruta, que contiene la información de la solicitud HTTP realizada por el cliente, incluyendo los archivos enviados en un formulario multipart/form-data.
 * @returns El archivo resuelto según el modo definido en las opciones del decorador: si el modo es "buffer", devuelve un objeto con el buffer del archivo, su nombre, tipo MIME y codificación; si el modo es "stream", devuelve un objeto con un stream de lectura del archivo, su nombre, tipo MIME y codificación.
 */
function ensureMultipartRequest(request: FastifyRequest): void {
  if (typeof request.isMultipart !== "function" || !request.isMultipart()) {
    throw new BadRequestException(
      "La petición debe ser 'multipart/form-data' para procesar archivos.",
    );
  }
}

/**
 * @description Lanza una excepción de BadRequestException indicando que falta el archivo requerido en el campo especificado. Esta función se utiliza para manejar el caso en que se espera un archivo en un campo específico del formulario multipart/form-data, pero no se encuentra ese archivo en la petición.
 * @param fieldKey Clave del campo del formulario multipart/form-data en el que se esperaba el archivo, que se incluye en el mensaje de la excepción para indicar al cliente qué campo falta.
 */
function throwMissingMultipartFile(fieldKey: string): never {
  throw new BadRequestException(
    `Falta el archivo requerido en el campo '${fieldKey}'.`,
  );
}

/**
 * @description Valida el tipo MIME de un archivo enviado en un formulario multipart/form-data comparándolo con una lista de tipos MIME permitidos definida en las opciones del decorador @File().
 * @param mimetype Tipo MIME del archivo a validar, que se obtiene del objeto que representa la parte del formulario multipart/form-data correspondiente al archivo.
 * @param allowedMimetypes Lista de tipos MIME permitidos definida en las opciones del decorador @File() para este parámetro. Es un array de strings que representa los tipos MIME permitidos, por ejemplo ["image/jpeg", "application/pdf"]. Si esta lista está definida y no está vacía, el tipo MIME del archivo debe estar incluido en esta lista para ser considerado válido.
 */
function validateMultipartFileMime(
  mimetype: string,
  allowedMimetypes?: string[],
): void {
  if (
    allowedMimetypes &&
    allowedMimetypes.length > 0 &&
    !allowedMimetypes.includes(mimetype)
  ) {
    throw new UnsupportedMediaTypeException(mimetype);
  }
}

/**
 * @description Resuelve el valor de un parámetro decorado con @File() en modo "buffer" extrayendo el archivo del request multipart/form-data que ya fue precargado en memoria por preparseMultipartFormData. Busca el archivo correspondiente a la clave definida en las opciones del decorador @File() en el mapa de archivos precargados dentro del objeto request. Si no se encuentra el archivo, lanza una excepción de BadRequestException indicando que falta el archivo requerido. Si se encuentra el archivo, valida su tipo MIME según las opciones definidas en el decorador y luego devuelve un objeto con el buffer del archivo, su nombre, tipo MIME y codificación.
 * @param param Metadata del parámetro decorado con @File(), que incluye la clave para extraer el archivo del request, las opciones de validación como maxSize y mimetypes, y el modo de procesamiento (buffer o stream).
 * @param request Objeto FastifyRequest de la ruta, que contiene la información de la solicitud HTTP realizada por el cliente, incluyendo los archivos enviados en un formulario multipart/form-data. Se asume que el formulario multipart ya fue precargado en memoria por preparseMultipartFormData y que los archivos están almacenados en un mapa dentro del objeto request.
 * @param mimetypes Lista de tipos MIME permitidos definida en las opciones del decorador @File() para este parámetro, que se utiliza para validar el tipo MIME del archivo encontrado. Es un array de strings que representa los tipos MIME permitidos, por ejemplo ["image/jpeg", "application/pdf"]. Si esta lista está definida y no está vacía, el tipo MIME del archivo debe estar incluido en esta lista para ser considerado válido.
 * @returns Un objeto con el buffer del archivo, su nombre, tipo MIME y codificación, que representa el archivo resuelto para este parámetro decorado con @File() en modo "buffer". Si no se encuentra el archivo o si su tipo MIME no es válido, se lanza una excepción correspondiente.
 */
function resolveBufferedMultipartFile(
  param: any,
  request: FastifyRequest,
  mimetypes?: string[],
): any {
  let fileData = (request as any)._filesMap?.get(param.key);

  if (!fileData && request.body) {
    const rawValue = (request.body as any)[param.key];
    if (rawValue) {
      // Normalizamos Fastify puede devolver objeto o array de objetos
      const file = Array.isArray(rawValue) ? rawValue[0] : rawValue;

      // Adaptamos el formato de Fastify al formato esperado por el decorador @File() para mantener la consistencia
      if (file?.filename) {
        fileData = {
          filename: file.filename,
          mimetype: file.mimetype,
          encoding: file.encoding,
          buffer: file.data, // El plugin usa .data para el Buffer
        };
      }
    }
  }

  if (!fileData) {
    throwMissingMultipartFile(param.key);
  }

  validateMultipartFileMime(fileData.mimetype, mimetypes);
  return fileData;
}

/**
 * @description Resuelve el valor de un parámetro decorado con @File() en modo "stream" extrayendo el archivo del request multipart/form-data directamente del stream proporcionado por Fastify al iterar sobre las partes del formulario multipart. Busca la parte del formulario que corresponde al campo definido en las opciones del decorador @File() y que es de tipo "file". Si no se encuentra esa parte, lanza una excepción de BadRequestException indicando que falta el archivo requerido. Si se encuentra la parte correspondiente al archivo, valida su tipo MIME según las opciones definidas en el decorador y luego devuelve un objeto con un stream de lectura del archivo, su nombre, tipo MIME y codificación. Este modo es útil para manejar archivos grandes sin cargarlos completamente en memoria.
 * @param param Metadata del parámetro decorado con @File(), que incluye la clave para extraer el archivo del request, las opciones de validación como maxSize y mimetypes, y el modo de procesamiento (buffer o stream).
 * @param request Objeto FastifyRequest de la ruta, que contiene la información de la solicitud HTTP realizada por el cliente, incluyendo los archivos enviados en un formulario multipart/form-data. Se asume que el formulario multipart ya fue precargado en memoria por preparseMultipartFormData y que los archivos están almacenados en un mapa dentro del objeto request.
 * @param maxSize Tamaño máximo permitido para el archivo, definido en las opciones del decorador @File() para este parámetro. Si se especifica y el archivo excede este tamaño, se lanza una excepción de PayloadTooLargeException.
 * @param mimetypes Lista de tipos MIME permitidos definida en las opciones del decorador @File() para este parámetro, que se utiliza para validar el tipo MIME del archivo encontrado. Es un array de strings que representa los tipos MIME permitidos, por ejemplo ["image/jpeg", "application/pdf"]. Si esta lista está definida y no está vacía, el tipo MIME del archivo debe estar incluido en esta lista para ser considerado válido.
 * @returns Un objeto con un stream de lectura del archivo, su nombre, tipo MIME y codificación, que representa el archivo resuelto para este parámetro decorado con @File() en modo "stream". Si no se encuentra el archivo o si su tipo MIME no es válido, se lanza una excepción correspondiente.
 */
async function resolveStreamMultipartFile(
  param: any,
  request: FastifyRequest,
  maxSize?: number,
  mimetypes?: string[],
): Promise<any> {
  try {
    for await (const part of request.parts({
      limits: { fileSize: maxSize },
    })) {
      // Si la parte es un campo de formulario (no un archivo), la agregamos al body para
      // que esté disponible en los decoradores @Body() si el dev lo necesita
      if (part.type === "field") {
        request.body = request.body || {};
        (request.body as any)[part.fieldname] = part.value;
        continue;
      }

      if (part.type !== "file") {
        continue;
      }

      if (part.fieldname !== param.key) {
        part.file.resume();
        continue;
      }

      validateMultipartFileMime(part.mimetype, mimetypes);

      return {
        filename: part.filename,
        mimetype: part.mimetype,
        encoding: part.encoding,
        stream: part.file,
      };
    }

    throwMissingMultipartFile(param.key);
  } catch (error: any) {
    mapMultipartSizeError(error, maxSize);
  }
}

/**
 * @description Resuelve el valor de un parámetro decorado con @File() extrayendo el archivo del request multipart/form-data. Dependiendo del modo definido en las opciones del decorador (@File({ mode: "buffer" }) o @File({ mode: "stream" })), resuelve el archivo como un buffer cargado en memoria o como un stream de lectura, respectivamente.
 * @param param Metadata del parámetro decorado con @File(), que incluye la clave para extraer el archivo del request, las opciones de validación como maxSize y mimetypes, y el modo de procesamiento (buffer o stream).
 * @param request Objeto FastifyRequest de la ruta, que contiene la información de la solicitud HTTP realizada por el cliente, incluyendo los archivos enviados en un formulario multipart/form-data.
 * @returns El archivo resuelto según el modo definido en las opciones del decorador: si el modo es "buffer", devuelve un objeto con el buffer del archivo, su nombre, tipo MIME y codificación; si el modo es "stream", devuelve un objeto con un stream de lectura del archivo, su nombre, tipo MIME y codificación.
 */
async function resolveMultipartFile(
  param: any,
  request: FastifyRequest,
): Promise<any> {
  ensureMultipartRequest(request);

  const options = param.fileOptions || {};
  const maxSize = options.maxSize;
  const mimetypes = options.mimetypes;
  const mode = options.mode || "buffer";

  // Si ya esta precargado en memoria por preparseMultipartFormData,
  // lo resolvemos como buffer
  const body = request.body as any;
  const fileInBody = body?.[param.key];
  if (
    fileInBody &&
    (fileInBody.filename ||
      (Array.isArray(fileInBody) && fileInBody[0]?.filename))
  ) {
    return resolveBufferedMultipartFile(param, request, options.mimetypes);
  }

  if (mode === "stream") {
    return resolveStreamMultipartFile(param, request, maxSize, mimetypes);
  }

  return resolveBufferedMultipartFile(param, request, mimetypes);
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
  wsContext?: { socket: WebSocket; payload: any },
): Promise<any> {
  // Dependiendo del tipo de parámetro definido en la metadata del decorador,
  // extraemos su valor correspondiente del request o reply de Fastify.
  // Si el decorador de este parámetro tiene una clave definida (param.key),
  // extraemos solo esa clave específica del objeto correspondiente (por ejemplo, request.body[param.key]
  // o request.query[param.key]). Si no tiene una clave definida, extraemos
  // el objeto correspondiente (por ejemplo, request.body o request.query).
  switch (param.type) {
    case "body":
      return param.key === undefined
        ? request.body
        : (request.body as any)?.[param.key];
    case "query":
      return param.key === undefined
        ? request.query
        : (request.query as any)?.[param.key];
    case "param":
      return param.key === undefined
        ? request.params
        : (request.params as any)?.[param.key];
    case "headers":
      return param.key === undefined
        ? request.headers
        : request.headers[param.key.toLowerCase()];
    case "request":
      return request;
    case "reply":
      if (wsContext) {
        throw new InternalServerException(
          "[FastifyKit] No puedes usar @Res() dentro de un @WebSocketGateway. Retorna el valor directamente o utiliza @Socket().",
        );
      }
      return reply;
    case "ip":
      return request.ip;
    case "file":
      if (wsContext) {
        throw new InternalServerException(
          "[FastifyKit] No puedes usar @File() dentro de un @WebSocketGateway.",
        );
      }
      return resolveMultipartFile(param, request);
    case "cookie":
      // Si el plugin no se registró, request.cookies no existirá. Le avisamos al dev.
      if (!request.cookies) {
        throw new InternalServerException(
          "[FastifyKit] Intentaste usar @Cookie pero el módulo de cookies no está activado. Habilítalo en FastifyKit.create({ cookies: true }).",
        );
      }
      // Si pidió una key (ej: Cookie('token')), le damos esa. Si no, le damos todas.
      return param.key === undefined
        ? request.cookies
        : request.cookies[param.key];
    case "socket":
      if (!wsContext) {
        throw new InternalServerException(
          "[FastifyKit] No puedes usar @Socket() fuera de un @WebSocketGateway.",
        );
      }
      return wsContext.socket;
    case "wsPayload":
      if (!wsContext) {
        throw new InternalServerException(
          "[FastifyKit] No puedes usar @WsPayload() fuera de un @WebSocketGateway.",
        );
      }
      return wsContext.payload;
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
export async function extractArguments(
  request: FastifyRequest,
  reply: FastifyReply,
  methodParamsMeta: any[],
  wsContext?: { socket: WebSocket; payload: any },
): Promise<any[]> {
  if (!wsContext) {
    // Si la petición es multipart/form-data y aún no se ha precargado
    if (typeof request.isMultipart === "function" && request.isMultipart()) {
      request.body = request.body || {}; // Inicializamos el body en caso de,
    }

    // Antes de extraer los argumentos, pre-parseamos el formulario multipart en memoria si la petición es multipart/form-data
    await preparseMultipartFormData(request, methodParamsMeta);
  }

  // Ordenamos los parámetros decorados para procesar primero los que son de tipo "file" con modo "stream",
  // ya que estos no se precargan en memoria y deben ser resueltos directamente desde el stream del request.
  // Esto es importante para evitar problemas de rendimiento al acceder a archivos grandes sin cargarlos
  // completamente en memoria, y también para asegurar que el stream del archivo esté disponible para
  // ser leído cuando se procese el parámetro correspondiente.
  const sortedParams = [...methodParamsMeta].sort((a, b) => {
    const isAStream = a.type === "file" && a.fileOptions?.mode === "stream";
    const isBStream = b.type === "file" && b.fileOptions?.mode === "stream";
    if (isAStream && !isBStream) return -1;
    if (!isAStream && isBStream) return 1;
    return 0;
  });

  // Creamos un array de argumentos que se pasará al método del controlador,
  // donde cada posición corresponde al índice definido en los decoradores de parámetros.
  const args: any[] = [];

  // Iteramos sobre cada parámetro decorado y extraemos su valor del request o reply según el tipo de parámetro definido en la metadata del decorador
  for (const param of sortedParams) {
    let value = await resolveParamValue(param, request, reply, wsContext);

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
