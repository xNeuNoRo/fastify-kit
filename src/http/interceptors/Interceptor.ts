import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * @description El contexto de ejecución actual para el interceptor.
 */
export interface ExecutionContext {
  request: FastifyRequest; 
  reply: FastifyReply; // Esto es extensible luego para GraphQL, etc...
}

/**
 * @description El handler que invoca el siguiente paso en la cadena.
 */
export interface CallHandler<T = unknown> {
  handle(): Promise<T>;
}

/**
 * @description Contrato estricto que los Interceptores en FastifyKit deben cumplir.
 * T: Tipo de lo que devuelve el CallHandler (el controlador).
 * R: Tipo de lo que finalmente retorna el Interceptor.
 */
export interface Interceptor<T = unknown, R = unknown> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Promise<R> | R;
}
