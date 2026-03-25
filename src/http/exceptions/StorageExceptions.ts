import { HttpException } from "./HttpException";
import { ErrorCode } from "./ErrorCodes";

export class FileTooLargeException extends HttpException {
  constructor(maxSize: string = "permitido") {
    super(
      `El archivo excede el tamaño máximo permitido de ${maxSize}.`,
      ErrorCode.FILE_TOO_LARGE,
      413,
    );
  }
}

export class UnsupportedMediaTypeException extends HttpException {
  constructor(mimeType: string = "desconocido") {
    super(
      `El formato de archivo o contenido '${mimeType}' no está permitido o no es soportado.`,
      ErrorCode.UNSUPPORTED_MEDIA_TYPE,
      415,
    );
  }
}

export class StorageQuotaExceededException extends HttpException {
  constructor(
    message: string = "Has superado tu cuota de almacenamiento disponible.",
  ) {
    super(message, ErrorCode.STORAGE_QUOTA_EXCEEDED, 507);
  }
}
