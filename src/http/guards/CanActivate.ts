import { FastifyRequest, FastifyReply } from "fastify";

export interface CanActivate<TContext = FastifyReply> {
  /**
   * @returns `true` si la petición puede continuar, `false` si debe ser bloqueada.
   * Si devuelve `false`, el framework lanzará un ForbiddenException automáticamente.
   */
  canActivate(
    request: FastifyRequest,
    reply: TContext,
  ): boolean | Promise<boolean>;
}
