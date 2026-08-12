import type { DIContainer } from "../../container/DIContainer.js";
import type { TracerService } from "../contracts/TracerService.js";
import type { MetricsService } from "../contracts/MetricsService.js";
import {
  SEMATTR_MESSAGING_SYSTEM,
  SEMATTR_MESSAGING_OPERATION,
  SEMATTR_WS_MESSAGE_TYPE,
  SEMATTR_WS_CONNECTION_ID,
} from "../utils/semantic-conventions.js";
import {
  SEMVAL_MESSAGING_OPERATION_RECEIVE,
} from "../utils/semantic-conventions.js";
import { SpanKind, SpanStatusCode } from "../contracts/TracerService.js";
import { WsGatewayRegistry } from "../../websockets/WsGatewayRegistry.js";

/**
 * @description Instrumenta el WsGatewayRegistry para crear spans de traza
 * al recibir mensajes WebSocket. Envuelve el processIncomingMessage del
 * messageRouter para capturar cada mensaje entrante.
 *
 * Esto permite trazar la comunicación en tiempo real:
 * Cliente WS → WsGateway → processIncomingMessage → Controller Handler
 *
 * Métricas registradas:
 * - ws_messages_total{gateway, type, direction}
 *
 * Atributos semánticos:
 * - messaging.system: "ws"
 * - messaging.operation: "receive"
 * - ws.message.type: tipo de mensaje (json, binary, text)
 * - ws.connection.id: ID de la conexión WebSocket
 *
 * @param container Contenedor DI para resolver WsGatewayRegistry
 * @param tracer Servicio de trazas para crear spans CONSUMER
 * @param metrics Servicio de métricas para el contador de mensajes
 */
export function instrumentWsGatewayRegistry(
  container: DIContainer,
  tracer: TracerService,
  metrics: MetricsService,
): void {
  try {
    const gatewayRegistry = container.resolve(WsGatewayRegistry);
    if (!gatewayRegistry || (gatewayRegistry as any).__otelPatched) return;

    const originalRegister =
      gatewayRegistry.registerGateways.bind(gatewayRegistry);

    /**
     * Wrapper que envuelve registerGateways para instrumentar el
     * procesamiento de mensajes entrantes (processIncomingMessage).
     */
    gatewayRegistry.registerGateways = function (
      app: any,
      gateways: any[],
    ): void {
      const origProcessIncoming =
        (gatewayRegistry as any).messageRouter?.processIncomingMessage;

      // Si existe el messageRouter, envolvemos su método de procesamiento
      if (origProcessIncoming) {
        (gatewayRegistry as any).messageRouter.processIncomingMessage =
          async function (params: any) {
            const span = tracer.startSpan("ws.message", {
              kind: SpanKind.CONSUMER,
              attributes: {
                [SEMATTR_MESSAGING_SYSTEM]: "ws",
                [SEMATTR_MESSAGING_OPERATION]: SEMVAL_MESSAGING_OPERATION_RECEIVE,
                [SEMATTR_WS_MESSAGE_TYPE]: "message",
                [SEMATTR_WS_CONNECTION_ID]:
                  params.connection?.id || "unknown",
              },
            });

            try {
              await origProcessIncoming.call(
                (gatewayRegistry as any).messageRouter,
                params,
              );

              metrics.increment("ws_messages_total", {
                gateway: params.connection?.namespace || "default",
                type: "message",
                direction: "inbound",
              });

              span.setStatus(SpanStatusCode.OK);
            } catch (err) {
              span.recordException(err as Error);
              throw err;
            } finally {
              span.end();
            }
          };
      }

      return originalRegister(app, gateways);
    };

    (gatewayRegistry as any).__otelPatched = true;
  } catch {
    // WsGatewayRegistry no disponible (no se configuraron WebSockets)
  }
}
