import fp from "fastify-plugin";
import type { FastifyInstance, FastifyPluginAsync } from "fastify";

import { ApiResponse } from "../responses/ApiResponse.js";
import {
  HttpException,
  NotFoundException,
  ValidationException,
  MalformedJsonException,
  InternalServerException,
  TooManyRequestsException,
  ForbiddenException,
} from "../exceptions/index.js";
import { getLogger } from "../../logger/logger.factory.js";

const errorHandlerPlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  // Handler para rutas no encontradas (404)
  app.setNotFoundHandler((request, reply) => {
    const logger = getLogger();

    // Registramos un mensaje de advertencia cada vez que se intente acceder a una ruta no definida
    logger.warn(
      `[Route Not Found] Se intentó acceder a: ${request.method} ${request.url}`,
      { method: request.method, url: request.url, ip: request.ip },
    );

    // Creamos una instancia de NotFoundException para representar el error de ruta no encontrada
    const notFoundException = new NotFoundException("Endpoint", request.url);

    // Respondemos con un error 404 utilizando el formato de respuesta de ApiResponse.failure
    return reply
      .status(notFoundException.statusCode)
      .send(ApiResponse.failure(notFoundException.toApiError()));
  });

  // Handler global para errores no manejados en las rutas
  app.setErrorHandler((error: any, request, reply) => {
    const logger = getLogger();
    let httpException: HttpException;

    // Si el error es una instancia de HttpException
    if (error instanceof HttpException) {
      httpException = error;

      if (httpException.statusCode >= 400 && httpException.statusCode < 500) {
        logger.warn(
          `[Domain Error] ${httpException.code} - ${httpException.message}`,
          {
            code: httpException.code,
            message: httpException.message,
            statusCode: httpException.statusCode,
          },
        );
      }
    }
    // Si el error tiene un campo "validation" (indica errores de validación en Fastify)
    else if (error.validation) {
      logger.warn(`[Validation Error] Falla en ${error.validationContext}`, {
        validationContext: error.validationContext,
        validationErrors: error.validation,
      });
      httpException = new ValidationException(error.validation);
    }
    // Si el error es un error de JSON malformado
    // Tipicamente con ese codigo en Fastify se indica que el body de la petición no es un JSON válido
    else if (
      error.code === "FST_ERR_CTP_INVALID_JSON_BODY" ||
      error.statusCode === 400
    ) {
      logger.warn(`[Bad Request] Petición malformada: ${error.message}`);
      httpException = new MalformedJsonException();
    } else if (error.statusCode === 403) {
      //  Caso específico, El usuario ha sido baneado luego de X intentos de exceder el límite de peticiones
      logger.warn(`[Rate Limit BAN] Usuario baneado en ${request.ip}`, {
        url: request.url,
        method: request.method,
      });
      // Convertimos a una ForbiddenException con un mensaje claro
      httpException = new ForbiddenException(
        "Has sido baneado temporalmente por abusar del límite de peticiones.",
      );
    } else if (error.statusCode === 429) {
      // Caso estándar: Límite excedido (429)
      logger.warn(`[Rate Limit] Límite excedido para ${request.ip}`);
      httpException = new TooManyRequestsException();
    }
    // Errores desconocidos (Es el "Catch-All" de seguridad por si acaso)
    else {
      const errorMessage =
        error.message || error.code || "Unknown Internal Error";

      logger.error(`[Fatal Error] ${errorMessage}`, {
        stack: error.stack,
        method: request.method,
        url: request.url,
      });
      httpException = new InternalServerException();
    }

    // Respuesta final estandarizada
    return reply
      .status(httpException.statusCode)
      .send(ApiResponse.failure(httpException.toApiError()));
  });
};

// Exportamos el plugin utilizando fastify-plugin para que pueda ser registrado en la app Fastify.
export const fastifyKitErrorHandler = fp(errorHandlerPlugin, {
  name: "fastify-kit-error-handler",
});
