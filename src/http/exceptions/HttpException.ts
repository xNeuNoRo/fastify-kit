import { MapTo } from "../../utils/map-to.decorator";
import { ApiError } from "../responses/ApiError";
import { ErrorCode } from "./ErrorCodes";

export abstract class HttpException<T = unknown> extends Error {
  constructor(
    public readonly message: string,
    public readonly code: ErrorCode | (string & {}),
    public readonly statusCode: number = 400,
    public readonly details?: T,
  ) {
    super(message);
    this.name = this.constructor.name;
    // Esto es necesario para capturar correctamente la pila de llamadas en V8 (Node.js)
    Error.captureStackTrace(this, this.constructor);
  }

  @MapTo(ApiError)
  public toApiError(): ApiError<T> {
    return new ApiError<T>(this.code, this.message, this.details);
  }
}
