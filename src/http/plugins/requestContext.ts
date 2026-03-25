import { randomUUID } from "node:crypto";
import fp from "fastify-plugin";
import { FastifyPluginAsync } from "fastify";
import { requestContext } from "../context/requestContext";

const requestContextPlugin: FastifyPluginAsync = async (app) => {
  // onRequest es la primera fase del ciclo de vida de Fastify. Aquí es donde vamos a inicializar el contexto de la solicitud
  app.addHook("onRequest", (request, reply, done) => {
    // Obtenemos un ID de solicitud único
    const requestId =
      (request.headers["x-request-id"] as string) || randomUUID();

    // Agregamos el ID de solicitud a la respuesta para que el cliente pueda rastrear la solicitud
    reply.header("x-request-id", requestId);

    // Creamos un store específico para esta solicitud,
    // que en este caso es un Map con una propiedad "requestId".
    // Este store se puede extender con cualquier otro dato que
    // queramos asociar a la solicitud (como información del usuario, datos de autenticación, etc.).
    const store = new Map<string, any>();
    store.set("requestId", requestId);

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
