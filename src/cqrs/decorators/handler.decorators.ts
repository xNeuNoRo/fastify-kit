import { container } from "../../container/DIContainer.js";
import { FastifyKitMetadata } from "../../http/decorators/types.js";
import { Constructor } from "../../http/routing/scanner/index.js";
import { getCqrsHandlerToken } from "../utils/cqrs-token.util.js";

/**
 * @description Decorador para marcar una clase como el handler de un Comando específico.
 * @param commandClass La clase del Comando que este handler procesará.
 */
export function CommandHandler(commandClass: Constructor) {
  return function <T extends new (...args: any[]) => any>(
    target: T,
    context: ClassDecoratorContext,
  ) {
    if (context.kind !== "class") {
      throw new Error(
        `[FastifyKit CQRS] @CommandHandler solo puede usarse en clases.`,
      );
    }

    const metadata = context.metadata as FastifyKitMetadata;
    metadata.cqrsHandler = true;

    const token = getCqrsHandlerToken(commandClass);
    container.registerClass(token, target);
  };
}

/**
 * @description Decorador para marcar una clase como el handler de una Query específica.
 * @param queryClass La clase de la Query que este handler procesará.
 */
export function QueryHandler(queryClass: Constructor) {
  return function <T extends new (...args: any[]) => any>(
    target: T,
    context: ClassDecoratorContext,
  ) {
    if (context.kind !== "class") {
      throw new Error(
        `[FastifyKit CQRS] @QueryHandler solo puede usarse en clases.`,
      );
    }

    const metadata = context.metadata as FastifyKitMetadata;
    metadata.cqrsHandler = true;

    const token = getCqrsHandlerToken(queryClass);
    container.registerClass(token, target);
  };
}
