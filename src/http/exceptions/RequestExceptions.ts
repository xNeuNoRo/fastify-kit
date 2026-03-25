import { HttpException } from "./HttpException";
import { ErrorCode } from "./ErrorCodes";

export class BadRequestException extends HttpException {
  constructor(message: string = "Petición incorrecta o mal formada") {
    super(message, ErrorCode.BAD_REQUEST, 400);
  }
}

export class ValidationException<T = any> extends HttpException<T> {
  constructor(
    details: T,
    message: string = "Se encontraron errores de validación",
  ) {
    super(message, ErrorCode.VALIDATION_ERROR, 400, details);
  }
}

export class MalformedJsonException extends HttpException {
  constructor(
    message: string = "El cuerpo de la petición no es un JSON válido o está malformado",
  ) {
    super(message, ErrorCode.MALFORMED_JSON, 400);
  }
}

export class TooManyRequestsException extends HttpException {
  constructor(
    message: string = "Has superado el límite de peticiones permitido",
  ) {
    super(message, ErrorCode.TOO_MANY_REQUESTS, 429);
  }
}

export class TooManyAttemptsException extends HttpException {
  constructor(
    message: string = "Demasiados intentos fallidos. Por favor, espera un momento",
  ) {
    super(message, ErrorCode.TOO_MANY_ATTEMPTS, 429);
  }
}
