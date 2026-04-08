import type { FastifyRequest } from "fastify";
import {
  FileTooLargeException,
  UnsupportedMediaTypeException,
} from "../../exceptions/StorageExceptions.js";
import { BadRequestException } from "../../exceptions/RequestExceptions.js";

/**
 * @description Formatea el tamaño máximo permitido para archivos en un mensaje legible para humanos.
 */
export function formatFileSizeLimit(maxSize?: number): string {
  return maxSize ? `${(maxSize / 1024 / 1024).toFixed(2)}MB` : "permitido";
}

/**
 * @description Verifica si la petición es multipart/form-data y si se debe precargar en memoria.
 */
export function shouldPreparseMultipart(
  request: FastifyRequest,
  hasStreamFiles: boolean,
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
        (v &&
          typeof v === "object" &&
          ("filename" in v || "data" in v || "value" in v)) ||
        Buffer.isBuffer(v) ||
        (Array.isArray(v) && (v[0]?.filename || Buffer.isBuffer(v[0]))),
    );
    if (alreadyParsed) return false;
  }

  return !hasStreamFiles;
}

/**
 * @description Inicializa las propiedades necesarias en el objeto request para almacenar archivos.
 */
export function initializeMultipartRequest(request: FastifyRequest): void {
  (request as any)._multipartParsed = true;
  (request as any)._filesMap = new Map();
  request.body = request.body || {};
}

/**
 * @description Obtiene el tamaño máximo permitido para archivos definido en los decoradores @File().
 */
export function getGlobalMaxFileSize(
  methodParamsMeta: any[],
): number | undefined {
  const maxSizes = methodParamsMeta
    .filter((p) => p.type === "file" && p.fileOptions?.maxSize)
    .map((p) => p.fileOptions!.maxSize!);

  return maxSizes.length > 0 ? Math.max(...maxSizes) : undefined;
}

/**
 * @description Mapea los errores de límite de tamaño de Fastify a FileTooLargeException.
 */
export function mapMultipartSizeError(error: any, maxSize?: number): never {
  if (error.code === "FST_REQ_FILE_TOO_LARGE") {
    throw new FileTooLargeException(formatFileSizeLimit(maxSize));
  }

  throw error;
}

/**
 * @description Maneja cada parte del formulario multipart que corresponde a un archivo.
 */
export async function handleMultipartFilePart(
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
 * @description Pre-parsea el formulario multipart/form-data en memoria.
 */
export async function preparseMultipartFormData(
  request: FastifyRequest,
  hasFiles: boolean,
  hasStreamFiles: boolean,
  globalMaxSize?: number,
): Promise<void> {
  // Si no es multipart o ya se procesó, salir de inmediato de forma síncrona
  if (
    typeof request.isMultipart !== "function" ||
    !request.isMultipart() ||
    (request as any)._multipartParsed
  ) {
    return;
  }

  // Si la ruta no tiene decoradores @File(), no tiene sentido intentar consumir el stream
  if (!hasFiles) {
    return;
  }

  if (typeof request.isMultipart === "function" && request.isMultipart()) {
    request.body = request.body || {};
  }

  if (!shouldPreparseMultipart(request, hasStreamFiles)) {
    return;
  }

  // Si por alguna razon el stream ya esta cerrado, no intentamos preparsear para evitar errores.
  if (request?.raw?.readableEnded) return;

  initializeMultipartRequest(request);

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
 * @description Asegura que la petición sea multipart/form-data.
 */
export function ensureMultipartRequest(request: FastifyRequest): void {
  if (typeof request.isMultipart !== "function" || !request.isMultipart()) {
    throw new BadRequestException(
      "La petición debe ser 'multipart/form-data' para procesar archivos.",
    );
  }
}

/**
 * @description Lanza una excepción si falta un archivo requerido.
 */
export function throwMissingMultipartFile(fieldKey: string): never {
  throw new BadRequestException(
    `Falta el archivo requerido en el campo '${fieldKey}'.`,
  );
}

/**
 * @description Valida el tipo MIME de un archivo.
 */
export function validateMultipartFileMime(
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

export function resolveBufferedMultipartFile(
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

      if (Buffer.isBuffer(file)) {
        fileData = {
          filename: "uploaded_file", // Nombre generico ya que no podemos obtenerlo del buffer
          mimetype: "application/octet-stream",
          encoding: "7bit",
          buffer: file,
        };
      } else if (file && typeof file === "object" && file?.filename) {
        fileData = {
          filename: file.filename || "uploaded_file",
          mimetype: file.mimetype || "application/octet-stream",
          encoding: file.encoding || "7bit",
          buffer:
            file.data ||
            file.value ||
            (Buffer.isBuffer(file) ? file : undefined),
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
 * @description Resuelve un archivo en modo stream directamente de Fastify.
 */
export async function resolveStreamMultipartFile(
  param: any,
  request: FastifyRequest,
  maxSize?: number,
  mimetypes?: string[],
  isOptional: boolean = false,
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

    if (isOptional) return undefined;

    throwMissingMultipartFile(param.key);
  } catch (error: any) {
    mapMultipartSizeError(error, maxSize);
  }
}

/**
 * @description Orquestador de resolución de archivos para el decorador @File().
 */
export async function resolveMultipartFile(
  param: any,
  request: FastifyRequest,
): Promise<any> {
  ensureMultipartRequest(request);

  const options = param.fileOptions || {};
  const maxSize = options.maxSize;
  const mimetypes = options.mimetypes;
  const mode = options.mode || "buffer";
  const isOptional = options.optional === true;

  // Si ya esta precargado en memoria por preparseMultipartFormData,
  // lo resolvemos como buffer
  const body = request.body as any;
  const fileInBody = body?.[param.key];
  const existsInBody =
    Buffer.isBuffer(fileInBody) ||
    fileInBody?.filename ||
    (Array.isArray(fileInBody) && fileInBody[0]?.filename);
  if (existsInBody) {
    return resolveBufferedMultipartFile(param, request, options.mimetypes);
  }

  const existsInMap = (request as any)._filesMap?.has(param.key);
  if (!existsInBody && !existsInMap && mode === "buffer" && isOptional) {
    return undefined;
  }

  if (mode === "stream") {
    return resolveStreamMultipartFile(
      param,
      request,
      maxSize,
      mimetypes,
      isOptional,
    );
  }

  return resolveBufferedMultipartFile(param, request, mimetypes);
}
