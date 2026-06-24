import type { FastifyRequest } from "fastify";
import { getLogger } from "../logger/logger.factory.js";
import { extractArguments } from "../http/routing/scanner/parameter.resolver.js";
import type { Constructor } from "../http/routing/scanner/index.js";
import { WsEventHandlerMetadata } from "./decorators/types.js";
import type { FastifyKitSocket } from "./interfaces/FastifyKitSocket.js";

/**
 * @description Manejador del ciclo de vida de eventos WebSocket.
 * Ejecuta los handlers de @OnConnect, @OnDisconnect y mapea la metadata
 * de eventos (@SubscribeMessage, @OnMessage) hacia routers de patrones.
 */
export class WsLifecycleHandler {
  /**
   * @description Ejecuta un método de ciclo de vida (connect/disconnect).
   * Extrae los argumentos necesarios según los decoradores de parámetros
   * y ejecuta el método en la instancia del Gateway. En caso de error
   * en @OnConnect, cierra la conexión con código 1011.
   */
  async executeLifecycleMethod(
    methodName: PropertyKey,
    GatewayClass: Constructor,
    instance: any,
    preSortedParams: Map<PropertyKey, any[]>,
    request: FastifyRequest,
    connection: FastifyKitSocket,
    isConnectEvent: boolean,
  ): Promise<void> {
    try {
      // Extraemos los argumentos necesario y lo ejecutamos
      const paramsMeta = preSortedParams.get(methodName) || [];
      const args = await extractArguments(
        request,
        null as any,
        paramsMeta,
        false,
        false,
        undefined,
        {
          socket: connection as any,
          payload: null,
        },
      );
      await instance[methodName](...args);
    } catch (err: any) {
      const eventName = isConnectEvent ? "@OnConnect" : "@OnDisconnect";
      // En caso de error, lo logueamos pero no hacemos nada más
      getLogger().error(
        `[FastifyKit WS] Error en ${eventName} de ${GatewayClass.name}:`,
        err,
      );
      if (isConnectEvent) {
        connection.close(1011, "Internal Server Error");
      }
    }
  }

  /**
   * @description Mapea la metadata de eventos de un Gateway para extraer
   * los nombres de los métodos de @OnConnect, @OnDisconnect y los handlers
   * de mensajes (con y sin patrón / firehose).
   */
  mapGatewayEvents(
    events: WsEventHandlerMetadata[],
    eventRouter: Map<string, PropertyKey>,
  ): {
    onConnectMethod: PropertyKey | null;
    onDisconnectMethod: PropertyKey | null;
    firehoseMethod: PropertyKey | null;
  } {
    // Variables para almacenar los nombres de los métodos manejadores de eventos de conexión, desconexión y mensajes sin patrón (firehose)
    let onConnectMethod: PropertyKey | null = null;
    let onDisconnectMethod: PropertyKey | null = null;
    let firehoseMethod: PropertyKey | null = null;

    // Iteramos sobre la metadata de eventos para definir los métodos manejadores de cada tipo de evento y sus patrones asociados
    for (const event of events) {
      if (event.type === "connect") onConnectMethod = event.handlerName;
      if (event.type === "disconnect") onDisconnectMethod = event.handlerName;
      if (event.type === "message" && event.pattern)
        eventRouter.set(event.pattern, event.handlerName);
      if (event.type === "message" && !event.pattern)
        firehoseMethod = event.handlerName;
    }

    return { onConnectMethod, onDisconnectMethod, firehoseMethod };
  }
}
