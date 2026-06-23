import type { FastifyRequest } from "fastify";
import type { Constructor } from "../http/routing/scanner/index.js";
import { extractArguments } from "../http/routing/scanner/parameter.resolver.js";
import { getLogger } from "../logger/logger.factory.js";
import type {
  BaseWebSocket,
  FastifyKitSocket,
} from "./interfaces/FastifyKitSocket.js";
import { WsAdapter } from "./interfaces/WsAdapter.js";
import { WsGuardExecutor } from "./WsGuardExecutor.js";

/**
 * @description Router de mensajes WebSocket. Se encarga de decodificar mensajes
 * entrantes, enrutarlos al handler correcto según el patrón, ejecutar guards
 * de método, extraer argumentos y codificar/enviar la respuesta al cliente.
 */
export class WsMessageRouter {
  /**
   * @description Resuelve el nombre del handler a ejecutar basado en el patrón del mensaje.
   * Si hay un handler registrado para ese patrón exacto, lo devuelve.
   * Si no, devuelve el handler de firehose (catch-all) si está definido, o null.
   */
  resolveHandlerName(
    pattern: string | undefined,
    eventRouter: Map<string, PropertyKey>,
    firehoseMethod: PropertyKey | null,
  ): PropertyKey | null {
    // Si el mensaje entrante tiene un patrón definido y existe un handler registrado para ese patrón, devolvemos el nombre de ese handler. Si no, devolvemos el handler de firehose (si está definido) o null si no hay ningún handler disponible para manejar el mensaje.
    if (pattern && eventRouter.has(pattern)) {
      return eventRouter.get(pattern)!;
    }
    // Si el mensaje no tiene un patrón definido o no existe un handler registrado para ese patrón, devolvemos el handler de firehose si está definido, o null si no hay ningún handler disponible para manejar el mensaje.
    return firehoseMethod;
  }

  /**
   * @description Envía una respuesta formateada al cliente WebSocket.
   * Si hay un patrón definido, usa el adaptador para codificar.
   * Si no, intenta serializar como string/JSON.
   */
  sendMessageResponse(
    connection: BaseWebSocket,
    adapter: WsAdapter,
    pattern: string | undefined,
    result: unknown,
  ): void {
    if (result === undefined || connection.readyState !== 1) return;

    // Si el mensaje entrante tenía un patrón definido,
    // usamos el adaptador para codificar la respuesta y enviarla al cliente.
    if (pattern) {
      const encodedResponse = adapter.encode(pattern, result);
      connection.send(encodedResponse);
      return;
    }

    let rawResponse: string;

    // Si no, intentamos convertir la respuesta a string o JSON según su tipo, y la enviamos como texto plano al cliente.
    if (typeof result === "string") {
      rawResponse = result;
    } else if (
      typeof result === "number" ||
      typeof result === "boolean" ||
      typeof result === "bigint" ||
      typeof result === "symbol"
    ) {
      rawResponse = String(result);
    } else if (typeof result === "function") {
      rawResponse = result.toString();
    } else {
      try {
        rawResponse = JSON.stringify(result);
      } catch {
        rawResponse = JSON.stringify({ error: "UNSERIALIZABLE_RESPONSE" });
      }
    }

    // Enviamos la respuesta cruda al cliente WebSocket
    connection.send(rawResponse);
  }

  /**
   * @description Procesa un mensaje entrante de WebSocket: decodifica,
   * enruta al handler, ejecuta guards, extrae argumentos y envía respuesta.
   */
  async processIncomingMessage({
    rawMessage,
    GatewayClass,
    instance,
    preSortedParams,
    request,
    connection,
    adapter,
    eventRouter,
    firehoseMethod,
    methodGuards,
  }: {
    rawMessage: string | Buffer | Uint8Array;
    GatewayClass: Constructor;
    instance: any;
    preSortedParams: Map<PropertyKey, any[]>;
    request: FastifyRequest;
    connection: FastifyKitSocket;
    adapter: WsAdapter;
    eventRouter: Map<string, PropertyKey>;
    firehoseMethod: PropertyKey | null;
    methodGuards: Map<PropertyKey, Constructor[]>;
  }): Promise<void> {
    let currentPattern: string | undefined = undefined;

    try {
      const packet = adapter.decode(rawMessage);
      const pattern = packet.pattern ?? undefined;
      currentPattern = pattern;

      // Resolvemos el handler correspondiente al patrón del mensaje entrante.
      const handlerName = this.resolveHandlerName(
        pattern,
        eventRouter,
        firehoseMethod,
      );

      // Si no encontramos un handler para el patrón del mensaje,
      // en lugar de ignorarlo en silencio, le avisamos al cliente (si está conectado) que no se encontró un handler para ese patrón específico.
      if (!handlerName) {
        if (connection.readyState === 1) {
          connection.send(
            "ERROR:HANDLER_NOT_FOUND_FOR_PATTERN:" + packet.pattern,
          );
        }
        return;
      }

      // Si el handler tiene guards a nivel de método, los ejecutamos antes de procesar el mensaje.
      // Si algún guard deniega el acceso, le avisamos al cliente que no tiene permisos para
      // acceder a ese evento y detenemos la ejecución al instante.
      const guards = methodGuards.get(handlerName);
      if (guards && guards.length > 0) {
        const guardExecutor = new WsGuardExecutor();
        const isAllowed = await guardExecutor.executeMethodGuards(
          guards,
          request,
          connection,
        );
        if (!isAllowed) {
          this.sendMessageResponse(connection, adapter, pattern, {
            error: "Forbidden",
            message:
              "Acceso denegado, no tienes permiso para ejecutar esta acción.",
            statusCode: 403,
          });
          return; // Detenemos la ejecución al instante
        }
      }

      // Extraemos los argumentos necesarios para ejecutar el handler y lo ejecutamos
      const paramsMeta = preSortedParams.get(handlerName) || [];
      const args = await extractArguments(
        request,
        null as any,
        paramsMeta,
        false,
        false,
        undefined,
        {
          socket: connection as any,
          payload: packet.payload,
        },
      );
      const result = await instance[handlerName](...args);

      // Enviamos la respuesta del handler de vuelta al cliente WebSocket
      this.sendMessageResponse(connection, adapter, pattern, result);
    } catch (err: any) {
      if (connection.readyState === 1) {
        if (err.validation || err.name === "ValidationException") {
          this.sendMessageResponse(connection, adapter, currentPattern, {
            error: "Bad Request",
            message: "Datos inválidos o malformados.",
            details: err.validation || err.message,
            statusCode: 400,
          });
        } else {
          // Para cualquier otro error no controlado (500)
          this.sendMessageResponse(connection, adapter, currentPattern, {
            error: "Internal Server Error",
            message: "Error interno ejecutando el evento.",
            statusCode: 500,
          });
        }
      }
      getLogger().error(
        `[FastifyKit WS] Error procesando mensaje en ${GatewayClass.name}:`,
        err,
      );
    }
  }
}
