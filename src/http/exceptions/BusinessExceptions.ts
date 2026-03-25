import { HttpException } from "./HttpException";
import { ErrorCode } from "./ErrorCodes";

export class BusinessRuleException extends HttpException {
  constructor(
    message: string,
    code: ErrorCode | (string & {}) = ErrorCode.BUSINESS_RULE_VIOLATION,
  ) {
    super(message, code, 422);
  }
}

export class InvalidOperationException extends HttpException {
  constructor(message: string) {
    super(message, ErrorCode.INVALID_OPERATION, 400);
  }
}

export class SessionLimitReachedException extends HttpException {
  constructor() {
    super(
      "Has alcanzado el límite máximo de sesiones activas",
      ErrorCode.SESSION_LIMIT_REACHED,
      403,
    );
  }
}

export class PaymentRequiredException extends HttpException {
  constructor() {
    super(
      "Se requiere un pago para completar esta acción",
      ErrorCode.PAYMENT_REQUIRED,
      402,
    );
  }
}
