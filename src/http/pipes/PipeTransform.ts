export interface PipeTransform<T = any, R = any> {
  /**
   * @description Transforma el valor de entrada y devuelve el resultado procesado.
   * Puede ser asíncrono para permitir validaciones contra DB o servicios externos.
   * @param value El valor de entrada que se desea transformar.
   * @returns El valor transformado, o una promesa que resuelve el valor transformado.
   * @example
   * class ParseIntPipe implements PipeTransform<string, number> {
   *   transform(value: string): number {
   *     const parsed = parseInt(value, 10);
   *     if (isNaN(parsed)) {
   *       throw new Error("Validation failed: Not a number");
   *     }
   *     return parsed;
   *   }
   * }
   */
  transform(value: T): R | Promise<R>;
}
