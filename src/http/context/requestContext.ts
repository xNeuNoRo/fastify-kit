import { AlsStore } from "./AlsStore.js";

export interface RequestContext {
  requestId: string;
  /** Mapa interno para almacenar instancias de Request Scope en el DI Container */
  diInstances?: Map<any, any>;
}

/**
 * @description Instancia global de AlsStore<RequestContext> que se utilizará para almacenar datos relacionados con la solicitud a lo largo de toda la cadena de llamadas asíncronas. Esta instancia se puede importar y utilizar en cualquier parte del código para acceder al contexto de la solicitud actual, permitiendo mantener datos como requestId, userId, etc., sin necesidad de pasarlos explícitamente como argumentos.
 * @example
 * // Como ya viene incluida en un hook onRequest de fastify por defecto
 * // Solo debes utilizarla de esta forma dentro de tus controladores, servicios, etc.
 * // OJO: Solo funcionara dentro del contexto de una solicitud/request, es decir,
 * // dentro de un hook, controlador, servicio, etc. que se ejecute como parte del ciclo de vida de una solicitud HTTP.
 * const requestId = requestContext.get("requestId");
 * console.log(requestId); // Imprime el ID de solicitud actual
 */
export const requestContext = new AlsStore<RequestContext>();
