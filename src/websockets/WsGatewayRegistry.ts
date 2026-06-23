import type {} from "@fastify/websocket";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { container } from "../container/DIContainer.js";
import { JsonWsAdapter } from "./adapters/JsonWsAdapter.js";
import type { FastifyKitMetadata } from "../http/decorators/types.js";
import type { Constructor } from "../http/routing/scanner/index.js";
import type { FastifyKitSocket } from "./interfaces/FastifyKitSocket.js";
import { getRoomManager } from "./managers/room-manager.factory.js";
import { WsConnectionManager } from "./WsConnectionManager.js";
import { WsMessageRouter } from "./WsMessageRouter.js";
import { WsGuardExecutor } from "./WsGuardExecutor.js";
import { WsLifecycleHandler } from "./WsLifecycleHandler.js";

const decoratorMetadataSymbol: symbol =
  (Symbol as any).metadata ?? Symbol.for("Symbol.metadata");

/**
 * @description Orquestador de registro de gateways WebSocket.
 * Coordina los servicios de conexión, routing, guards y ciclo de vida
 * para registrar cada @WebSocketGateway en la instancia de Fastify.
 *
 * Reemplaza la antigua función monolítica registerGateways() de 130 líneas
 * con una arquitectura compuesta por servicios enfocados y testeables.
 */
export class WsGatewayRegistry {
  private readonly connectionManager = new WsConnectionManager();
  private readonly messageRouter = new WsMessageRouter();
  private readonly guardExecutor = new WsGuardExecutor();
  private readonly lifecycleHandler = new WsLifecycleHandler();

  /**
   * @description Registra todos los gateways WebSocket encontrados en los módulos.
   * Para cada Gateway: configura heartbeat, parsea metadata, registra ruta Fastify,
   * y configura los handlers de conexión, mensajes y desconexión.
   */
  registerGateways(app: FastifyInstance, gateways: Constructor[]): void {
    for (const GatewayClass of gateways) {
      const metadata = (GatewayClass as any)[
        decoratorMetadataSymbol
      ] as FastifyKitMetadata;

      // Si no tiene decorador de @WebSocketGateway, lo ignoramos
      if (!metadata?.wsGateway) continue;

      // Configuramos el mecanismo de heartbeat para mantener vivas las conexiones WebSocket
      this.connectionManager.setupHeartbeatAndTeardown(app);

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
        this.lifecycleHandler.mapGatewayEvents(events, eventRouter);

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

      // Preparamos un mapa de guards a nivel de método
      // para poder ejecutarlos rápidamente antes de procesar cada mensaje entrante.
      const methodGuards = new Map<PropertyKey, Constructor[]>();
      if (metadata.methodGuards) {
        for (const [method, guards] of Object.entries(
          metadata.methodGuards,
        )) {
          // Solo guardamos el array si realmente tiene elementos
          if (guards && guards.length > 0) methodGuards.set(method, guards);
        }
      }

      // Si el Gateway tiene guards a nivel de clase, construimos un handler
      // para ejecutarlos antes de procesar cualquier evento de WebSocket.
      // Si algún guard deniega el acceso, se lanzará una excepción y no se procesará el evento.
      const classGuards = metadata.classGuards || [];
      const preHandler = this.guardExecutor.buildClassGuardHandler(classGuards);

      // Obtenemos el gestor de salas activo para poder usarlo
      // en los handlers de eventos de conexión, desconexión y mensajes.
      const roomManager = getRoomManager();

      // Registramos la ruta del WebSocket en Fastify usando la configuración del decorador y el handler para gestionar las conexiones entrantes, mensajes y desconexiones
      app.get(
        options.path,
        { websocket: true, ...(preHandler ? { preHandler } : {}) },
        (connection: any, request: FastifyRequest) => {
          const socket = (connection?.socket ||
            connection) as FastifyKitSocket & { on: Function };
          // Extraemos el namespace del path del gateway para que los
          // handlers puedan usarlo y separar mejor la lógica si el mismo handler maneja varios namespaces.
          this.connectionManager.setupSocketMetadata(
            socket,
            options.path,
            roomManager,
            adapter,
          );

          // Registramos el handler de @OnConnect() para que se ejecute cuando un cliente se conecte
          if (onConnectMethod) {
            this.lifecycleHandler.executeLifecycleMethod(
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
            await this.messageRouter.processIncomingMessage({
              rawMessage,
              GatewayClass,
              instance,
              preSortedParams,
              request,
              connection: socket,
              adapter,
              eventRouter,
              firehoseMethod,
              methodGuards,
            });
          });

          // Evento de desconexión del cliente
          socket.on("close", async () => {
            // Nos aseguramos de limpiar el socket de todas
            // las salas a las que pertenece para evitar memory leaks
            await socket.leaveAll();

            if (onDisconnectMethod) {
              await this.lifecycleHandler.executeLifecycleMethod(
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
          socket.on("pong", () => {
            socket.isAlive = true;
          });
        },
      );
    }
  }
}
