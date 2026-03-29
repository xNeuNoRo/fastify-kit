import { FastifyKitMetadata } from "../../http/decorators/types.js";

/**
 * @description Función auxiliar para crear decoradores de eventos de WebSockets (connect, disconnect, message). Esta función genera un decorador que, al ser aplicado a un método dentro de una clase marcada como WebSocketGateway, agrega metadata a la clase indicando que ese método es un manejador para el tipo de evento especificado. En el caso de eventos de tipo "message", también se puede especificar un patrón para filtrar los mensajes entrantes.
 * @param type El tipo de evento de WebSocket que se va a manejar: "connect", "disconnect" o "message".
 * @param pattern (Opcional) Solo se aplica para eventos de tipo "message". Es un string que representa el patrón que se usará para filtrar los mensajes entrantes. Por ejemplo, si se especifica "chatMessage", solo los mensajes que tengan ese patrón serán manejados por el método decorado.
 * @returns Un decorador de método que agrega la metadata correspondiente a la clase del gateway para indicar que el método es un manejador de eventos de WebSockets.
 */
function createWsEventDecorator(
  type: "connect" | "disconnect" | "message",
  pattern?: string,
) {
  return function (
    target: Function | Object,
    context: string | symbol | ClassMethodDecoratorContext,
  ) {
    if (typeof context === "object" && context.kind !== "method") {
      throw new Error(
        `[FastifyKit] Un decorador de evento WebSocket (${type}) solo puede ser aplicado a métodos.`,
      );
    }

    const propertyKey = typeof context === "object" ? context.name : context;

    // Extraemos el constructor de la clase
    const constructorFn = (typeof target === "function"
      ? target
      : target.constructor) as unknown as Record<symbol, unknown>;

    // Accedemos a la metadata de la clase
    const metadataSymbol =
      (Symbol as SymbolConstructor & { metadata?: symbol }).metadata ??
      Symbol.for("Symbol.metadata");

    // Aseguramos que la clase tenga un objeto de metadata y luego agregamos la información del evento a ese objeto
    constructorFn[metadataSymbol] = constructorFn[metadataSymbol] || {};
    const metadata = constructorFn[metadataSymbol] as FastifyKitMetadata;
    metadata.wsEvents = metadata.wsEvents || [];

    // Agregamos la información del evento a la metadata de la clase
    metadata.wsEvents.push({
      handlerName: String(propertyKey),
      type,
      pattern,
    });
  };
}

/**
 * @description Decorador para marcar un método como manejador del evento de conexión de WebSockets. Este decorador agrega metadata a la clase del gateway indicando que el método decorado debe ser ejecutado cada vez que un cliente se conecte al WebSocket.
 * @returns Una función que actúa como decorador de método, agregando la metadata necesaria para identificar el método como un manejador del evento de conexión de WebSockets.
 * @example
 * \@WebSocketGateway("/chat")
 * class ChatGateway {
 *   \@OnConnect()
 *   handleConnection(client: Socket) {
 *     console.log("Cliente conectado:", client.id);
 *   }
 * }
 */
export const OnConnect = () => createWsEventDecorator("connect");

/**
 * @description Decorador para marcar un método como manejador del evento de desconexión de WebSockets. Este decorador agrega metadata a la clase del gateway indicando que el método decorado debe ser ejecutado cada vez que un cliente se desconecte del WebSocket.
 * @returns Una función que actúa como decorador de método, agregando la metadata necesaria para identificar el método como un manejador del evento de desconexión de WebSockets.
 * @example
 * \@WebSocketGateway("/chat")
 * class ChatGateway {
 *   \@OnDisconnect()
 *   handleDisconnect(client: Socket) {
 *     console.log("Cliente desconectado:", client.id);
 *   }
 * }
 */
export const OnDisconnect = () => createWsEventDecorator("disconnect");

/**
 * @description Decorador para marcar un método como manejador de eventos de mensajes de WebSockets. Este decorador agrega metadata a la clase del gateway indicando que el método decorado debe ser ejecutado cada vez que se reciba un mensaje que coincida con el patrón especificado (si se proporciona). Si no se proporciona un patrón, el método manejará todos los mensajes entrantes.
 * @param pattern (Opcional) Un string que representa el patrón que se usará para filtrar los mensajes entrantes. Por ejemplo, si se especifica "chatMessage", solo los mensajes que tengan ese patrón serán manejados por el método decorado. Si no se proporciona un patrón, el método manejará todos los mensajes entrantes.
 * @returns Una función que actúa como decorador de método, agregando la metadata necesaria para identificar el método como un manejador de eventos de mensajes de WebSockets.
 * @example
 * \@WebSocketGateway("/chat")
 * class ChatGateway {
 *   \@SubscribeMessage("chatMessage")
 *   handleChatMessage(client: Socket, payload: any) {
 *     console.log("Mensaje de chat recibido:", payload);
 *   }
 * }
 * // O sin patrón para manejar todos los mensajes
 * \@WebSocketGateway("/chat")
 * class ChatGateway {
 *   \@OnMessage()
 *   handleMessage(client: Socket, payload: any) {
 *     console.log("Mensaje recibido:", payload);
 *   }
 * }
 */
export const SubscribeMessage = (pattern: string) =>
  createWsEventDecorator("message", pattern);

/**
 * @description Decorador para marcar un método como manejador de eventos de mensajes de WebSockets sin un patrón específico. Este decorador es una versión simplificada de \@SubscribeMessage que se puede usar cuando se desea que el método maneje todos los mensajes entrantes sin filtrar por patrón.
 * @returns Una función que actúa como decorador de método, agregando la metadata necesaria para identificar el método como un manejador de eventos de mensajes de WebSockets.
 * @example
 * \@WebSocketGateway("/chat")
 * class ChatGateway {
 *   \@OnMessage()
 *   handleMessage(client: Socket, payload: any) {
 *     console.log("Mensaje recibido:", payload);
 *   }
 * }
 */
export const OnMessage = () => createWsEventDecorator("message");
