import { HttpException } from "./HttpException";
import { ErrorCode } from "./ErrorCodes";

export class UnauthorizedException extends HttpException {
  constructor(
    message: string = "No estás autorizado para acceder a este recurso.",
  ) {
    super(message, ErrorCode.UNAUTHORIZED, 401);
  }
}

export class TokenExpiredException extends HttpException {
  constructor() {
    super(
      "Tu sesión ha expirado. Por favor, inicia sesión nuevamente.",
      ErrorCode.TOKEN_EXPIRED,
      401,
    );
  }
}

export class TokenInvalidException extends HttpException {
  constructor() {
    super(
      "El token proporcionado no es válido o está mal formado.",
      ErrorCode.TOKEN_INVALID,
      401,
    );
  }
}

export class ForbiddenException extends HttpException {
  constructor(
    message: string = "No tienes permisos suficientes para acceder a este recurso.",
  ) {
    super(message, ErrorCode.FORBIDDEN, 403);
  }
}

export class InsufficientPermissionsException extends HttpException {
  constructor() {
    super(
      "No tienes los permisos o roles necesarios para realizar esta acción.",
      ErrorCode.INSUFFICIENT_PERMISSIONS,
      403,
    );
  }
}

export class MfaRequiredException extends HttpException {
  constructor() {
    super(
      "Se requiere autenticación de dos factores (MFA) para continuar.",
      ErrorCode.MFA_REQUIRED,
      403,
    );
  }
}

export class AccountDisabledException extends HttpException {
  constructor() {
    super(
      "Tu cuenta ha sido desactivada o suspendida. Contacta con soporte.",
      ErrorCode.ACCOUNT_DISABLED,
      403,
    );
  }
}

export class EmailNotVerifiedException extends HttpException {
  constructor() {
    super(
      "Debes verificar tu correo electrónico antes de poder continuar.",
      ErrorCode.EMAIL_NOT_VERIFIED,
      403,
    );
  }
}

export class IpBlockedException extends HttpException {
  constructor() {
    super(
      "Tu dirección IP ha sido bloqueada temporalmente por motivos de seguridad.",
      ErrorCode.IP_BLOCKED,
      403,
    );
  }
}
