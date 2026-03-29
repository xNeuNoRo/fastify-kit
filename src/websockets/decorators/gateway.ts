import { FastifyKitMetadata } from "../../http/decorators/types.js";
import { Constructor } from "../../http/routing/scanner.js";
import { WebSocketGatewayOptions } from "./types.js";

/**
 * @description Decorador para marcar una clase como un gateway de WebSockets. Permite configurar la ruta del WebSocket y opcionalmente un adaptador personalizado para manejar la codificación y decodificación de mensajes. La metadata configurada por este decorador se puede utilizar posteriormente para registrar el gateway en el servidor de WebSockets y gestionar sus eventos.
 * @param pathOrOptions Puede ser una cadena que representa la ruta del WebSocket (ej: "/chat") o un objeto de opciones que incluye la ruta y un adaptador personalizado.
 * @returns Una función que envuelve la definición de la clase, agregando la metadata necesaria para identificarla como un gateway de WebSockets.
 * @example
 * \@WebSocketGateway("/chat")
 * class ChatGateway {
 *   // Métodos para manejar eventos de conexión, desconexión y mensajes
 * }
 * // O con opciones adicionales
 * \@WebSocketGateway({ path: "/chat", adapter: CustomWsAdapter })
 * class ChatGateway {
 *   // Métodos para manejar eventos de conexión, desconexión y mensajes
 * }
 */
export function WebSocketGateway(
  pathOrOptions: string | WebSocketGatewayOptions,
) {
  return function (target: Constructor, context: ClassDecoratorContext) {
    // Si no es una clase, lanzamos un error porque este decorador solo tiene sentido aplicado a clases
    if (context.kind !== "class") {
      throw new Error("@WebSocketGateway solo puede ser aplicado a clases");
    }

    // Leemos la configuración del decorador, normalizándola a un objeto de opciones
    const options =
      typeof pathOrOptions === "string"
        ? { path: pathOrOptions }
        : pathOrOptions;

    // Accedemos a la metadata de la clase
    const metadataSymbol: symbol =
      (Symbol as SymbolConstructor & { metadata?: symbol }).metadata ??
      Symbol.for("Symbol.metadata");

    // Aseguramos que la clase tenga un objeto de metadata y luego asignamos la configuración del gateway a ese objeto
    const targetConstructor = target as unknown as Record<symbol, unknown>;
    targetConstructor[metadataSymbol] = targetConstructor[metadataSymbol] || {};
    const metadata = targetConstructor[metadataSymbol] as FastifyKitMetadata;
    metadata.wsGateway = options;
  };
}
