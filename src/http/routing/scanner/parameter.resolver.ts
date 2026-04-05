import type { FastifyReply, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { container } from "../../../container/DIContainer.js";
import { InternalServerException } from "../../exceptions/index.js";
import type { PipeTransform } from "../../pipes/PipeTransform.js";
import {
  preparseMultipartFormData,
  resolveMultipartFile,
} from "./multipart.handler.js";

/**
 * @description Función genérica para resolver el valor de un parámetro decorado según su tipo.
 */
export async function resolveParamValue(
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
    case "custom":
      // Para parámetros personalizados, llamamos a la función customFactory definida
      // en la metadata del decorador, pasando el request y reply. Y retornamos su resultado.
      if (param.customFactory) {
        return await param.customFactory(request, reply);
      }
      return undefined;
    default:
      // Opcional: Lanza un error o devuelve undefined si el tipo no es soportado
      return undefined;
  }
}

/**
 * @description Extrae los argumentos a pasar al método del controlador.
 */
export async function extractArguments(
  request: FastifyRequest,
  reply: FastifyReply,
  sortedParamsMeta: any[],
  hasFiles: boolean,
  hasStreamFiles: boolean,
  globalMaxSize?: number,
  wsContext?: { socket: WebSocket; payload: any },
): Promise<any[]> {
  if (!wsContext) {
    // Si la petición es multipart/form-data y aún no se ha precargado
    if (
      typeof request.isMultipart === "function" &&
      request.isMultipart() &&
      !(request as any)._multipartParsed
    ) {
      request.body = request.body || {}; // Inicializamos el body en caso de,
    }

    // Antes de extraer los argumentos, pre-parseamos el formulario multipart en memoria si la petición es multipart/form-data
    await preparseMultipartFormData(
      request,
      hasFiles,
      hasStreamFiles,
      globalMaxSize,
    );
  }

  // Creamos un array de argumentos que se pasará al método del controlador,
  // donde cada posición corresponde al índice definido en los decoradores de parámetros.
  const args: any[] = [];

  // Iteramos sobre cada parámetro decorado y extraemos su valor del request o reply según el tipo de parámetro definido en la metadata del decorador
  for (const param of sortedParamsMeta) {
    let value;

    // Para los parámetros de tipo "request" y "reply", asignamos directamente el objeto request o reply sin usar 'await',
    // ya que no requieren procesamiento asíncrono para extraer su valor.
    if (param.type === "reply") {
      if (wsContext) {
        throw new InternalServerException(
          "[FastifyKit] No puedes usar @Res() dentro de un @WebSocketGateway.",
        );
      }
      value = reply; // Asignación síncrona directa, sin 'await'
    } else if (param.type === "request") {
      value = request; // Asignación síncrona directa
    } else {
      // Para el resto de cosas (body, query, params, files), usamos el await normal
      value = await resolveParamValue(param, request, reply, wsContext);
    }

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
