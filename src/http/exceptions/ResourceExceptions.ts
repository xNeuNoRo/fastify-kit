import { HttpException } from "./HttpException.js";
import { ErrorCode } from "./ErrorCodes.js";

export class NotFoundException extends HttpException {
  constructor(resource: string, identifier?: string | number) {
    const message = identifier
      ? `El recurso '${resource}' con identificador '${identifier}' no fue encontrado.`
      : `El recurso '${resource}' no fue encontrado.`;

    super(message, ErrorCode.NOT_FOUND, 404);
  }
}

export class AlreadyExistsException extends HttpException {
  constructor(resource: string, field?: string, value?: string) {
    let message = `El recurso '${resource}' ya existe.`;
    if (field && value) {
      message = `El recurso '${resource}' con ${field} '${value}' ya existe.`;
    }

    super(message, ErrorCode.ALREADY_EXISTS, 409);
  }
}

export class ConflictException extends HttpException {
  constructor(message: string = "Conflicto con el estado actual del recurso.") {
    super(message, ErrorCode.CONFLICT, 409);
  }
}

export class PreconditionFailedException extends HttpException {
  constructor(message: string = "No se cumplen las precondiciones necesarias para esta operación.") {
    super(message, ErrorCode.PRECONDITION_FAILED, 412);
  }
}

export class ResourceLockedException extends HttpException {
  constructor(resource: string) {
    super(
      `El recurso '${resource}' está bloqueado actualmente y no puede ser modificado.`,
      ErrorCode.RESOURCE_LOCKED,
      423,
    );
  }
}
