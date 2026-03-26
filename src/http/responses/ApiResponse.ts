import { ApiError } from "./ApiError.js";

export class ApiResponse<T, E = unknown> {
  constructor(
    public readonly ok: boolean,
    public readonly data: T | null = null,
    public readonly error: ApiError<E> | null = null,
    public readonly timestamp: string = new Date().toISOString(),
  ) {}

  /**
   * @description Crea una respuesta de éxito con los datos proporcionados.
   * @param data Los datos a incluir en la respuesta de éxito.
   * @returns Una instancia de ApiResponse con ok=true y los datos proporcionados.
   */
  static success<T>(data: T): ApiResponse<T, never> {
    return new ApiResponse(true, data, null);
  }

  /**
   * @description Sobrecarga para aceptar un objeto ApiError directamente y crear una respuesta de error.
   */
  static failure<E>(error: ApiError<E>): ApiResponse<null, E>;

  /**
   * @description Sobrecarga para crear una respuesta de error a partir de un código, mensaje y detalles opcionales.
   */
  static failure<E>(
    code: string,
    message: string,
    details?: E,
  ): ApiResponse<null, E>;

  /**
   * @description Implementación de la función de error que maneja ambas sobrecargas.
   * Si se pasa un ApiError, se utiliza directamente; de lo contrario, se crea un nuevo ApiError con los parámetros proporcionados.
   * @param first Puede ser un objeto ApiError o un string que representa el código de error.
   * @param message El mensaje de error, requerido si el primer parámetro es un string.
   * @param details Detalles adicionales del error, opcional si el primer parámetro es un string.
   * @returns Una instancia de ApiResponse con ok=false y el error correspondiente.
   */
  static failure<E>(
    first: string | ApiError<E>,
    message?: string,
    details?: E,
  ): ApiResponse<null, E> {
    // Si el primer argumento es una instancia de ApiError, se utiliza directamente para crear la respuesta de error.
    if (first instanceof ApiError) {
      return new ApiResponse(false, null, first);
    }

    // En caso contrario, se asume que el primer argumento es un código de error
    // y se crea un nuevo ApiError con el mensaje y detalles proporcionados.
    return new ApiResponse(false, null, new ApiError(first, message!, details));
  }
}
