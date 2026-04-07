import { HttpException } from "./HttpException.js";
import { ErrorCode } from "./ErrorCodes.js";

export class InternalServerException extends HttpException {
  constructor(
    message: string = "Ha ocurrido un error interno inesperado",
    details?: unknown,
  ) {
    super(message, ErrorCode.INTERNAL_SERVER_ERROR, 500, details);
  }
}

export class NotImplementedException extends HttpException {
  constructor(feature: string = "Esta funcionalidad") {
    super(
      `${feature} no ha sido implementada todavía.`,
      ErrorCode.NOT_IMPLEMENTED,
      501,
    );
  }
}

export class BadGatewayException extends HttpException {
  constructor(serviceName: string = "el servicio externo", details?: unknown) {
    super(
      `Se recibió una respuesta inválida de ${serviceName}.`,
      ErrorCode.EXTERNAL_SERVICE_ERROR, // Puedes mantener este código o crear uno BAD_GATEWAY
      502,
      details,
    );
  }
}

export class ServiceUnavailableException extends HttpException {
  constructor(
    message: string = "El servicio no está disponible temporalmente.",
    details?: unknown,
  ) {
    super(message, ErrorCode.SERVICE_UNAVAILABLE, 503, details);
  }
}

export class GatewayTimeoutException extends HttpException {
  constructor(serviceName: string = "El servicio o pasarela") {
    super(
      `${serviceName} agotó el tiempo de espera.`,
      ErrorCode.GATEWAY_TIMEOUT,
      504,
    );
  }
}
