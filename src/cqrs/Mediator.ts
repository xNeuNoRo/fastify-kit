import { container } from "../container/DIContainer.js";
import { Injectable } from "../container/injectable.decorator.js";
import type {
  IRequest,
  IRequestHandler,
} from "./interfaces/request.interface.js";
import { getCqrsHandlerToken } from "./utils/cqrs-token.util.js";

@Injectable()
export class Mediator {
  /**
   * @description Envía un comando o query al handler correspondiente.
   * @param request Instancia del comando/query que implementa IRequest<TResult>.
   * @returns El resultado procesado por el handler, con tipado automático.
   */
  public async send<TResult>(request: IRequest<TResult>): Promise<TResult> {
    // Generamos el token único que el decorador usará para registrar el handler
    const token = getCqrsHandlerToken(request.constructor as ObjectConstructor);

    // Intentamos resolver el handler desde el contenedor usando el token generado
    const handler =
      container.resolve<IRequestHandler<IRequest<TResult>, TResult>>(token);

    if (!handler) {
      throw new Error(
        `[FastifyKit CQRS] No se encontró un handler registrado para: ${request.constructor.name}. ` +
          `Asegúrate de usar el decorador @CommandHandler o @QueryHandler en la clase del handler.`,
      );
    }

    // Ejecutamos la lógica y retornamos la promesa
    return handler.handle(request);
  }
}
