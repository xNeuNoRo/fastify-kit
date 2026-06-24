import type { FastifyRequest, FastifyReply } from "fastify";
import { container } from "../container/DIContainer.js";
import { ForbiddenException } from "../http/exceptions/SecurityExceptions.js";
import type { Constructor } from "../http/routing/scanner/index.js";
import type { FastifyKitSocket } from "./interfaces/FastifyKitSocket.js";

/**
 * @description Ejecutor de guards para WebSockets. Maneja guards a nivel de clase
 * (pre-handshake) y a nivel de método (pre-message), resolviendo instancias
 * desde el contenedor DI y evaluando canActivate() en cada una.
 */
export class WsGuardExecutor {
  /**
   * @description Construye un preHandler de Fastify que ejecuta guards a nivel de clase.
   * Si todos los guards pasan, la conexión WebSocket continúa.
   * Si alguno falla, se lanza ForbiddenException y se rechaza la conexión.
   */
  buildClassGuardHandler(guards: Constructor[]) {
    if (guards.length === 0) return undefined;

    return async (request: FastifyRequest, reply: FastifyReply) => {
      for (const GuardClass of guards) {
        const guardInstance = container.resolve(GuardClass);
        const canActivate = await guardInstance.canActivate(request, reply);
        if (!canActivate) {
          throw new ForbiddenException("Acceso denegado a este WebSocket.");
        }
      }
    };
  }

  /**
   * @description Ejecuta guards a nivel de método antes de procesar un mensaje entrante.
   * Si algún guard deniega el acceso, devuelve false.
   * Si todos pasan, devuelve true.
   */
  async executeMethodGuards(
    guards: Constructor[],
    request: FastifyRequest,
    connection: FastifyKitSocket,
  ): Promise<boolean> {
    // Ejecutamos los guards definidos a nivel de método.
    // Si algún guard deniega el acceso, devolvemos false para indicar que no se debe procesar el mensaje.
    for (let i = 0; i < guards.length; i++) {
      // nosonar => for tradicional es mas rapido que el for...of
      const guardInstance = container.resolve(guards[i]);
      const canActivate = await guardInstance.canActivate(request, connection);
      if (!canActivate) return false;
    }
    return true;
  }
}
