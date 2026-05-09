import fp from "fastify-plugin";
import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { RequestContext, requestContext } from "../context/requestContext.js";

const requestContextPlugin: FastifyPluginAsync = async (app) => {
  // onRequest es la primera fase del ciclo de vida de Fastify. Aquí es donde vamos a inicializar el contexto de la solicitud
  app.addHook("onRequest", (request, reply, done) => {
    // Obtenemos un ID de solicitud único
    const requestId =
      (request.headers["x-request-id"] as string) || randomUUID();

    // Agregamos el ID de solicitud a la respuesta para que el cliente pueda rastrear la solicitud
    reply.header("x-request-id", requestId);

    // Creamos un store específico para esta solicitud,
    // que en este caso solo contiene el requestId
    // Este store se puede extender con cualquier otro dato que
    // queramos asociar a la solicitud (como información del usuario, datos de autenticación, etc.).
    const store: RequestContext = {
      requestId,
    };

    // Ejecutamos el resto del ciclo de vida de la solicitud dentro del contexto de la aplicación
    requestContext.run(store, () => {
      done();
    });
  });
};

// Exportamos el plugin utilizando fastify-plugin para que pueda ser registrado en la app Fastify.
export const fastifyKitRequestContext = fp(requestContextPlugin, {
  name: "fastify-kit-request-context",
});
