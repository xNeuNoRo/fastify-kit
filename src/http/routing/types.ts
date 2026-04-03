import type { FastifySchema } from "fastify";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export interface RouteDefinition {
  method: HttpMethod;
  path: string;
  handlerName: string | symbol;
  schema?: FastifySchema;
}
