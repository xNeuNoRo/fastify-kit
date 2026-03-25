import { AlsStore } from "./AlsStore";

export interface RequestContext extends Record<string, any> {
  requestId: string;
}

/**
 * @description Instancia global de AlsStore<RequestContext> que se utilizará para almacenar datos relacionados con la solicitud a lo largo de toda la cadena de llamadas asíncronas. Esta instancia se puede importar y utilizar en cualquier parte del código para acceder al contexto de la solicitud actual, permitiendo mantener datos como requestId, userId, etc., sin necesidad de pasarlos explícitamente como argumentos.
 * @example
 * // En un middleware de Express o Fastify, podrías establecer el contexto de la solicitud así:
 * app.use((req, res, next) => {
 *   const requestId = generateUniqueRequestId(); // Función para generar un ID único para la solicitud
 *   requestContext.run({ requestId }, () => {
 *     next();
 *   });
 * });
 */
export const requestContext = new AlsStore<RequestContext>();
