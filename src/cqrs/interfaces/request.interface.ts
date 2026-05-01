/**
 * @description Interfaz base para cualquier Comando o Query en el sistema.
 * El genérico TResult define qué devolverá el handler asociado.
 */
export interface IRequest<TResult = void> {
  // Propiedad solo para que TS infiera el tipo de retorno en el Mediator
  readonly _resultType?: TResult;
}

/**
 * @description Interfaz que debe implementar cualquier handler de comandos o queries.
 */
export interface IRequestHandler<
  TRequest extends IRequest<TResult>,
  TResult = void,
> {
  /**
   * @description Método principal que ejecuta la lógica del caso de uso.
   * @param request Instancia del comando o query con los datos necesarios.
   */
  handle(request: TRequest): Promise<TResult>;
}
