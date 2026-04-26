import { Injectable } from "../../container/injectable.decorator.js";
import { WebSocketGateway } from "../../websockets/decorators/gateway.js";
import {
  SubscribeMessage,
  OnDisconnect,
} from "../../websockets/decorators/events.js";
import {
  UseParams,
  Socket,
  WsPayload,
} from "../../http/decorators/parameters.js";
import type { FastifyKitSocket } from "../../websockets/interfaces/FastifyKitSocket.js";
import { getLogger } from "../../logger/logger.factory.js";

import { AbstractWebRtcGateway } from "./AbstractWebRtcGateway.js";
import type {
  WebRtcTransport,
  Producer,
  Consumer,
  DataProducer,
  DataConsumer,
  RtpCapabilities,
  RtpParameters,
  DtlsParameters,
  MediaKind,
  AppData,
} from "mediasoup/types";
import { WsBroadcaster } from "../../websockets/broadcaster/WsBroadcaster.js";
import { Inject } from "../../container/inject.decorator.js";
import { getRoomManager } from "../../websockets/managers/room-manager.factory.js";
import { getEventBus } from "../../events/eventbus.factory.js";
import {
  WEBRTC_MEDIA_SCORE_EVENT,
  WEBRTC_MEDIA_SCORE_PAYLOAD,
} from "../constants/WebRtcEvents.js";

/**
 * @description Estructura de memoria para rastrear los recursos de Mediasoup de un usuario específico.
 */
interface SfuClientState {
  roomId?: string;
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
  dataProducers: Map<string, DataProducer>;
  dataConsumers: Map<string, DataConsumer>;
}

@Injectable()
@WebSocketGateway("/webrtc")
export class DefaultWebRtcGateway extends AbstractWebRtcGateway {
  private readonly logger = getLogger();
  private readonly namespace = "/webrtc";

  @Inject(WsBroadcaster)
  private readonly broadcaster!: WsBroadcaster;

  /**
   * @description Sincroniza el socket con el WsRoomManager del framework.
   */
  private async joinWsRoom(
    socket: FastifyKitSocket,
    roomId: string,
  ): Promise<void> {
    const state = this.getState(socket);

    // Si el socket ya estaba en otra sala, lo sacamos primero
    if (state.roomId && state.roomId !== roomId) {
      await getRoomManager().leave(this.namespace, state.roomId, socket.id);
    }

    state.roomId = roomId;
    await getRoomManager().join(this.namespace, roomId, socket.id, socket);

    this.logger.info(
      `[WebRtcGateway] Socket ${socket.id} unido a la sala de señalización: ${roomId}`,
    );
  }

  /**
   * @description Helper para inicializar y obtener el estado SFU aislado de este socket.
   */
  private getState(socket: FastifyKitSocket): SfuClientState {
    if (!socket.data.sfu) {
      socket.data.sfu = {
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
        dataProducers: new Map(),
        dataConsumers: new Map(),
      };
    }

    return socket.data.sfu;
  }

  // -----------------------------------------------
  // Obtencion de las capacidades del router
  // -----------------------------------------------

  @SubscribeMessage("getRouterRtpCapabilities")
  @UseParams(Socket(), WsPayload())
  public async onGetRouterCapabilities(
    socket: FastifyKitSocket,
    payload: { roomId: string },
  ) {
    if (!payload.roomId) throw new Error("El id de la sala es requerido");

    // Unimos el socket a la sala de señalización para
    // que pueda recibir eventos relacionados con esa sala (ej. nuevos productores)
    await this.joinWsRoom(socket, payload.roomId);

    return await this.getRouterCapabilities(payload.roomId);
  }

  // -----------------------------------------------
  // Creacion y conexion de transportes
  // -----------------------------------------------

  @SubscribeMessage("createWebRtcTransport")
  @UseParams(Socket(), WsPayload())
  public async onCreateTransport(
    socket: FastifyKitSocket,
    payload: { roomId: string; appData?: AppData },
  ) {
    // Obtenemos el estado del cliente para almacenar el transporte creado
    const state = this.getState(socket);

    // Validaciones para evitar que un cliente cree transportes sin estar en una sala
    // o intente crear transportes para otra sala diferente a la que está unido
    if (!state.roomId)
      throw new Error(
        "Operación no autorizada: El cliente no está unido a ninguna sala SFU.",
      );

    if (payload.roomId !== state.roomId)
      throw new Error(
        "Acceso denegado: El id de la sala proporcionado no coincide con tu sala actual.",
      );

    const { transport, params } = await this.createWebRtcTransport({
      roomId: state.roomId, // Usamos el dato del servidor una vez hayamos validado
      appData: payload.appData,
    });

    // Guardamos el transporte en el estado del cliente usando su id como clave
    state.transports.set(transport.id, transport);

    this.logger.info(
      `[FastifyKit WebRtcGateway] Transporte creado: ${transport.id} para el Socket: ${socket.id}`,
    );

    // Retornamos los parámetros necesarios para que el cliente configure su transporte
    return params;
  }

  @SubscribeMessage("connectWebRtcTransport")
  @UseParams(Socket(), WsPayload())
  public async onConnectTransport(
    socket: FastifyKitSocket,
    payload: { transportId: string; dtlsParameters: DtlsParameters },
  ) {
    const transport = this.getState(socket).transports.get(payload.transportId);
    // Esto no tendria que pasar, pero validamos por si acaso para evitar errores difíciles de debuggear
    if (!transport)
      throw new Error(`Transporte ${payload.transportId} no encontrado`);

    // Conectamos el transporte usando los parámetros DTLS enviados por el cliente
    await this.connectWebRtcTransport(transport, payload.dtlsParameters);

    // Retornamos una respuesta simple indicando que la conexión fue exitosa
    return { connected: true };
  }

  // -----------------------------------------------
  // Creacion de productores y consumidores (AUDIO/VIDEO)
  // -----------------------------------------------

  @SubscribeMessage("produce")
  @UseParams(Socket(), WsPayload())
  public async onProduce(
    socket: FastifyKitSocket,
    payload: {
      roomId: string;
      transportId: string;
      kind: MediaKind;
      rtpParameters: RtpParameters;
      appData?: AppData;
    },
  ) {
    // obtenemos el transporte del estado del cliente
    const state = this.getState(socket);

    // Validaciones para evitar que un cliente produzca sin estar en una sala
    // o intente producir para otra sala diferente a la que está unido
    if (!state.roomId)
      throw new Error(
        "Operación no autorizada: El cliente no está unido a ninguna sala SFU.",
      );

    if (payload.roomId !== state.roomId)
      throw new Error(
        "Acceso denegado: El id de la sala proporcionado no coincide con tu sala actual.",
      );

    // obtenemos el transporte del estado del cliente usando el id enviado en el payload
    const transport = state.transports.get(payload.transportId);
    // Validamos que el transporte exista antes de intentar producir
    if (!transport) throw new Error("Transporte no encontrado para producir");

    // Creamos el productor usando el método de la clase base
    const producer = await this.createProducer(
      transport,
      payload.kind,
      payload.rtpParameters,
      payload.appData,
    );

    // Escuchamos el evento de score que emite mediasoup cada vez que hay una actualización en la calidad de la conexión de medios
    producer.on("score", (score) => {
      // Mediasoup entrega un array de scores, tomamos el del stream principal
      const currentScore = score[0]?.score || 0;

      const scorePayload: WEBRTC_MEDIA_SCORE_PAYLOAD = {
        roomId: state.roomId!,
        producerId: producer.id,
        socketId: socket.id,
        score: currentScore,
      };

      getEventBus().emit(WEBRTC_MEDIA_SCORE_EVENT, scorePayload);
    });

    // Guardamos el productor en el estado del cliente usando su id como clave
    state.producers.set(producer.id, producer);

    this.logger.info(
      `[FastifyKit WebRtcGateway] Productor [${producer.kind}] creado: ${producer.id} para el Socket: ${socket.id}`,
    );

    // Notificamos a los demás miembros de la sala que hay un nuevo productor disponible para consumir
    await this.broadcaster.emitToRoom(
      this.namespace,
      state.roomId,
      "newProducer",
      {
        socketId: socket.id,
        producerId: producer.id,
        kind: producer.kind,
        appData: producer.appData,
      },
      // Excluimos el socket que acaba de producir para evitar que reciba su propio evento
      [socket.id],
    );
    return { id: producer.id };
  }

  @SubscribeMessage("consume")
  @UseParams(Socket(), WsPayload())
  public async onConsume(
    socket: FastifyKitSocket,
    payload: {
      roomId: string;
      transportId: string;
      producerId: string;
      rtpCapabilities: RtpCapabilities;
      appData?: AppData;
    },
  ) {
    const state = this.getState(socket);

    // Validaciones para evitar fallos de seguridad
    if (!state.roomId)
      throw new Error(
        "Operación no autorizada: El cliente no está unido a ninguna sala SFU.",
      );

    if (payload.roomId !== state.roomId)
      throw new Error(
        "Acceso denegado: El id de la sala proporcionado no coincide con tu sala actual.",
      );

    const transport = state.transports.get(payload.transportId);
    if (!transport) throw new Error("Transporte de consumo no encontrado");

    // Creamos el consumidor usando el método de la clase base, pasando los parámetros necesarios
    const consumer = await this.createConsumer(
      state.roomId, // Usamos el dato del servidor una vez hayamos validado
      transport,
      payload.producerId,
      payload.rtpCapabilities,
      payload.appData,
    );

    // Guardamos el consumidor en el estado del cliente usando su id como clave
    state.consumers.set(consumer.id, consumer);

    // Retornamos los parámetros necesarios para que el cliente configure su consumidor
    return {
      id: consumer.id,
      producerId: payload.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  }

  @SubscribeMessage("resumeConsumer")
  @UseParams(Socket(), WsPayload())
  public async onResumeConsumer(
    socket: FastifyKitSocket,
    payload: { consumerId: string },
  ) {
    const state = this.getState(socket);

    // Buscamos el consumidor en el estado aislado de este cliente
    const consumer = state.consumers.get(payload.consumerId);

    if (!consumer) {
      throw new Error(`Consumidor con ID ${payload.consumerId} no encontrado.`);
    }

    // Reanudamos el flujo de medios desde el servidor hacia el cliente
    await consumer.resume();

    this.logger.debug(
      `[FastifyKit WebRtcGateway] Consumidor reanudado: ${consumer.id} para el Socket: ${socket.id}`,
    );

    return { resumed: true };
  }

  // -----------------------------------------------
  // Creacion de productores y consumidores de datos (DataChannels)
  // -----------------------------------------------

  @SubscribeMessage("produceData")
  @UseParams(Socket(), WsPayload())
  public async onProduceData(
    socket: FastifyKitSocket,
    payload: { transportId: string; appData?: AppData },
  ) {
    const state = this.getState(socket);
    if (!state.roomId)
      throw new Error(
        "Operación no autorizada: No estás unido a ninguna sala.",
      );
    const transport = state.transports.get(payload.transportId);
    if (!transport) throw new Error("Transporte no encontrado");

    // Creamos el productor de datos usando el método de la clase base
    const dataProducer = await this.createDataProducer(
      transport,
      payload.appData,
    );

    // Guardamos el productor de datos en el estado del cliente usando su id como clave
    state.dataProducers.set(dataProducer.id, dataProducer);

    // Notificamos a los demás miembros de la sala que hay un nuevo productor de datos disponible para consumir
    if (state.roomId) {
      await this.broadcaster.emitToRoom(
        this.namespace,
        state.roomId,
        "newDataProducer",
        {
          socketId: socket.id,
          dataProducerId: dataProducer.id,
          appData: dataProducer.appData,
        },
        // Excluimos el socket que acaba de producir para evitar que reciba su propio evento
        [socket.id],
      );
    }

    // Retornamos el id del productor de datos para que el cliente pueda referenciarlo al crear consumidores de datos
    return { id: dataProducer.id };
  }

  @SubscribeMessage("consumeData")
  @UseParams(Socket(), WsPayload())
  public async onConsumeData(
    socket: FastifyKitSocket,
    payload: { transportId: string; dataProducerId: string; appData?: AppData },
  ) {
    const state = this.getState(socket);
    if (!state.roomId)
      throw new Error(
        "Operación no autorizada: No estás unido a ninguna sala.",
      );
    const transport = state.transports.get(payload.transportId);
    if (!transport) throw new Error("Transporte no encontrado");

    // Creamos el consumidor de datos usando el método de la clase base
    const dataConsumer = await this.createDataConsumer(
      transport,
      payload.dataProducerId,
      payload.appData,
    );

    // Guardamos el consumidor de datos en el estado del cliente usando su id como clave
    state.dataConsumers.set(dataConsumer.id, dataConsumer);

    // Retornamos los parámetros necesarios para que el cliente configure su consumidor de datos
    return {
      id: dataConsumer.id,
      dataProducerId: payload.dataProducerId,
      // El cliente necesita los parámetros SCTP para configurar correctamente el DataConsumer
      sctpStreamParameters: dataConsumer.sctpStreamParameters,
    };
  }

  // -----------------------------------------------
  // Manejo de desconexiones para limpiar recursos
  // -----------------------------------------------

  @OnDisconnect()
  @UseParams(Socket())
  public async handleDisconnect(socket: FastifyKitSocket) {
    // Si no hay estado SFU, no hay nada que limpiar
    if (!socket.data.sfu) return;

    const state = socket.data.sfu;

    // Notificamos a los demás miembros de la sala que este socket
    // se ha desconectado y que deben limpiar los recursos asociados (producers, consumers, etc)
    if (state.roomId) {
      await this.broadcaster.emitToRoom(
        this.namespace,
        state.roomId,
        "peerClosed",
        { socketId: socket.id },
        [socket.id],
      );
    }

    // Cerramos todos los productores de medios que automaticamente mediasoup cerrara todos los producers y consumers asociados a esos transports
    for (const transport of state.transports.values()) {
      transport.close();
    }

    // Vaciamos los mapas para liberar referencias y permitir que el garbage collector limpie la memoria
    state.transports.clear();
    state.producers.clear();
    state.consumers.clear();
    state.dataProducers.clear();
    state.dataConsumers.clear();

    this.logger.info(
      `[FastifyKit WebRtcGateway] Recursos limpiados para Socket: ${socket.id}`,
    );
  }
}
