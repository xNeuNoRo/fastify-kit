import { FastifyRequest, FastifyReply } from "fastify";

export interface CanActivate {
  /**
   * @returns `true` si la petición puede continuar, `false` si debe ser bloqueada.
   * Si devuelve `false`, el framework lanzará un ForbiddenException automáticamente.
   */
  canActivate(
    request: FastifyRequest,
    reply: FastifyReply,
  ): boolean | Promise<boolean>;
}
