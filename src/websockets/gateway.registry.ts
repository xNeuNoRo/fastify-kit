import type {} from "@fastify/websocket";
import { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { getLogger } from "../logger/logger.factory.js";
import { container } from "../container/DIContainer.js";
import { JsonWsAdapter } from "./adapters/JsonWsAdapter.js";
import { WsEventHandlerMetadata } from "./decorators/types.js";
import type { FastifyKitMetadata } from "../http/decorators/types.js";
import { extractArguments } from "../http/routing/scanner/parameter.resolver.js";

export type Constructor<T = any> = new (...args: any[]) => T;

const decoratorMetadataSymbol: symbol =
  (Symbol as any).metadata ?? Symbol.for("Symbol.metadata");

function setupHeartbeatAndTeardown(app: FastifyInstance) {
  // Simple flag para evitar configurar el heartbeat más de una vez si se llama a registerGateways varias veces.
  if ((app as any)._wsHeartbeatSetup) return;
  (app as any)._wsHeartbeatSetup = true;

  // Handler para limpiar conexiones muertas cada 30 segundos
  const pingInterval = setInterval(() => {
    // Si el servidor de WebSockets está activo
    if (app.websocketServer) {
      // Iteramos sobre todos los clientes conectados al servidor de WebSockets
      for (const client of app.websocketServer.clients) {
        const wsClient = client as any;
        // Si el cliente no respondió al último ping, lo matamos.
        if (wsClient.isAlive === false) {
          client.terminate();
          continue;
        }
        // Marcamos el cliente como no vivo y le enviamos un ping. Si responde, lo marcaremos como vivo en el handler de pong.
        wsClient.isAlive = false;
        client.ping();
      }
    }
  }, 30000);

  // Desvinculamos el intervalo para que no impida que el proceso se cierre naturalmente si no hay otras tareas pendientes
  pingInterval.unref();

  // Apagamos el intervalo de limpieza de conexiones muertas cuando el servidor se cierra para evitar memory leaks
  app.addHook("onClose", (instance, done) => {
    clearInterval(pingInterval);
    if (instance.websocketServer) {
      for (const client of instance.websocketServer.clients) {
        client.terminate();
      }
    }
    done();
  });
}

async function executeLifecycleMethod(
  methodName: PropertyKey,
  GatewayClass: Constructor,
  instance: any,
  preSortedParams: Map<PropertyKey, any[]>,
  request: FastifyRequest,
  connection: WebSocket,
  isConnectEvent: boolean,
) {
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
        socket: connection,
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

function resolveHandlerName(
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

function sendMessageResponse(
  connection: WebSocket,
  adapter: any,
  pattern: string | undefined,
  result: unknown,
) {
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

async function processIncomingMessage({
  rawMessage,
  GatewayClass,
  instance,
  preSortedParams,
  request,
  connection,
  adapter,
  eventRouter,
  firehoseMethod,
}: {
  rawMessage: string | Buffer;
  GatewayClass: Constructor;
  instance: any;
  preSortedParams: Map<PropertyKey, any[]>;
  request: FastifyRequest;
  connection: WebSocket;
  adapter: any;
  eventRouter: Map<string, PropertyKey>;
  firehoseMethod: PropertyKey | null;
}) {
  try {
    const packet = adapter.decode(rawMessage);
    // Resolvemos el handler correspondiente al patrón del mensaje entrante.
    const handlerName = resolveHandlerName(
      packet.pattern,
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
        socket: connection,
        payload: packet.payload,
      },
    );
    const result = await instance[handlerName](...args);

    // Enviamos la respuesta del handler de vuelta al cliente WebSocket
    sendMessageResponse(connection, adapter, packet.pattern, result);
  } catch (err: any) {
    // En caso de error, le avisamos al cliente que hubo un error procesando el mensaje, y lo logueamos para que el desarrollador pueda investigarlo.
    if (connection.readyState === 1) {
      connection.send(
        `ERROR:EXECUTION_FAILED:${err.message || "Internal Server Error"}`,
      );
    }
    getLogger().error(
      `[FastifyKit WS] Error procesando mensaje en ${GatewayClass.name}:`,
      err,
    );
  }
}

function mapGatewayEvents(
  events: WsEventHandlerMetadata[],
  eventRouter: Map<string, PropertyKey>,
) {
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

export function registerGateways(
  app: FastifyInstance,
  gateways: Constructor[],
) {
  for (const GatewayClass of gateways) {
    const metadata = (GatewayClass as any)[
      decoratorMetadataSymbol
    ] as FastifyKitMetadata;

    // Si no tiene decorador de @WebSocketGateway, lo ignoramos
    if (!metadata?.wsGateway) continue;

    // Configuramos el mecanismo de heartbeat para mantener vivas las conexiones WebSocket
    setupHeartbeatAndTeardown(app);

    // Resolvemos la clase Gateway del contenedor de dependencias
    const instance = container.resolve(GatewayClass);
    // Y extraemos su metadata para registrar sus eventos de WebSockets
    const options = metadata.wsGateway;
    const events = metadata.wsEvents || [];

    // Instanciamos el adaptador de WebSockets definido en la configuración del decorador o usamos el adaptador por defecto (JsonWsAdapter)
    const AdapterClass = options.adapter || JsonWsAdapter;
    const adapter = new AdapterClass();

    // Mapas para almacenar los métodos de cada tipo de evento (connect, disconnect, message) y sus patrones asociados
    const eventRouter = new Map<string, PropertyKey>();

    // Mapeamos la metadata de eventos del Gateway
    const { onConnectMethod, onDisconnectMethod, firehoseMethod } =
      mapGatewayEvents(events, eventRouter);

    // Pre-ordenamos la metadata de parámetros para cada método decorado, para evitar tener que ordenarla en cada mensaje entrante. Esto mejora el rendimiento al procesar mensajes WebSocket, ya que la extracción de argumentos es una operación crítica que se ejecuta en cada mensaje entrante.
    const preSortedParams = new Map<PropertyKey, any[]>();
    if (metadata.parameters) {
      for (const [method, params] of Object.entries(metadata.parameters)) {
        preSortedParams.set(
          method,
          [...params].sort((a, b) => a.index - b.index),
        );
      }
    }

    // Registramos la ruta del WebSocket en Fastify usando la configuración del decorador y el handler para gestionar las conexiones entrantes, mensajes y desconexiones
    app.get(
      options.path,
      { websocket: true },
      (connection: any, request: FastifyRequest) => {
        const socket = connection?.socket || connection;
        socket.isAlive = true;

        // Registramos el handler de @OnConnect() para que se ejecute cuando un cliente se conecte
        if (onConnectMethod) {
          executeLifecycleMethod(
            onConnectMethod,
            GatewayClass,
            instance,
            preSortedParams,
            request,
            socket,
            true,
          );
        }

        socket.on("message", async (rawMessage: Buffer) => {
          await processIncomingMessage({
            rawMessage,
            GatewayClass,
            instance,
            preSortedParams,
            request,
            connection: socket,
            adapter,
            eventRouter,
            firehoseMethod,
          });
        });

        // Evento de desconexión del cliente
        connection.on("close", async () => {
          if (onDisconnectMethod) {
            await executeLifecycleMethod(
              onDisconnectMethod,
              GatewayClass,
              instance,
              preSortedParams,
              request,
              socket,
              false,
            );
          }
        });

        // Evento de ping recibido del cliente para mantener viva la conexión.
        connection.on("pong", () => {
          socket.isAlive = true;
        });
      },
    );
  }
}
