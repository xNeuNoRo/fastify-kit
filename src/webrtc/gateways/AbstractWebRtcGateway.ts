import type {
  WebRtcTransport,
  Producer,
  Consumer,
  RtpCapabilities,
  RtpParameters,
  DtlsParameters,
  DataProducer,
  DataConsumer,
  IceParameters,
  IceCandidate,
  MediaKind,
  AppData,
  WebRtcTransportOptions,
  WebRtcServer,
} from "mediasoup/types";
import {
  SfuRoomManager,
} from "../interfaces/SfuRoomManager.js";
import { DEFAULT_TRANSPORT_OPTIONS } from "../constants/WebRtcConfig.js";
import { getSfuRoomManager } from "../managers/sfu-manager.factory.js";

/**
 * @description Interfaz que define la estructura de la respuesta al crear un transporte WebRTC en el gateway, incluyendo el transporte creado y los parámetros necesarios para establecer la conexión WebRTC.
 */
export interface WebRtcTransportResponse {
  transport: WebRtcTransport;
  params: {
    id: string;
    iceParameters: IceParameters;
    iceCandidates: IceCandidate[];
    dtlsParameters: DtlsParameters;
  };
}

/**
 * @description Clase abstracta que proporciona métodos comunes para gestionar la lógica de WebRTC en un gateway,
 * incluyendo la creación y conexión de transportes WebRTC, así como la creación de productores y consumidores
 * de medios y datos. Esta clase sirve como base para implementaciones específicas de gateways que interactúan
 * con un SfuRoomManager para manejar las salas SFU y sus recursos asociados.
 */
export abstract class AbstractWebRtcGateway {
  /**
   * @description Obtiene el manager de salas SFU. Utiliza el factory para garantizar
   * que siempre exista una instancia válida (Inyección perezosa / Lazy Loading).
   */
  protected get roomManager(): SfuRoomManager {
    return getSfuRoomManager();
  }

  /**
   * @description Obtiene las capacidades RTP de una sala SFU específica, identificada por su ID.
   * @param roomId El ID de la sala SFU para la cual se desean obtener las capacidades RTP.
   * @returns Un objeto de tipo RtpCapabilities que contiene las capacidades RTP de la sala SFU especificada. Si la sala no existe, se lanza un error.
   */
  protected async getRouterCapabilities(
    roomId: string,
  ): Promise<RtpCapabilities> {
    const router = await this.roomManager.getOrCreateRoom(roomId);
    return router.rtpCapabilities;
  }

  /**
   * @description Crea un transporte WebRTC para una sala SFU específica, utilizando las opciones
   * de transporte predeterminadas y cualquier configuración adicional proporcionada.
   * @param roomId El ID de la sala SFU para la cual se desea crear el transporte WebRTC.
   * @param appData Datos de aplicación opcionales que se pueden asociar al transporte WebRTC.
   * @returns Un objeto de tipo WebRtcTransportResponse que contiene el transporte WebRTC creado
   */
  protected async createWebRtcTransport<TAppData extends AppData = AppData>({
    roomId,
    appData,
    webRtcServer,
  }: {
    roomId: string;
    appData?: TAppData;
    webRtcServer?: WebRtcServer<TAppData>;
  }): Promise<WebRtcTransportResponse> {
    const router = this.roomManager.getRoom(roomId);

    const transportOptions: Record<string, unknown> = {
      ...DEFAULT_TRANSPORT_OPTIONS,
      appData,
    };

    if (router.appData?.webRtcServer || webRtcServer) {
      transportOptions.webRtcServer =
        router.appData.webRtcServer || webRtcServer;
    } else if (!transportOptions.listenIps && !transportOptions.listenInfos) {
      throw new Error(
        "[FastifyKit WebRTC] Configuración de transporte incompleta. " +
          "El Router no tiene 'webRtcServer' en su appData y no se definieron 'listenIps' o 'listenInfos'. " +
          "Si creaste un SfuRoomManager personalizado, asegúrate de inyectar el servidor o configurar las IPs.",
      );
    }

    const transport = await router.createWebRtcTransport(
      transportOptions as WebRtcTransportOptions<TAppData>,
    );

    return {
      transport,
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      },
    };
  }

  /**
   * @description Conecta un transporte WebRTC utilizando los parámetros DTLS proporcionados.
   * @param transport El transporte WebRTC que se desea conectar.
   * @param dtlsParameters Los parámetros DTLS necesarios para establecer la conexión WebRTC.
   */
  protected async connectWebRtcTransport(
    transport: WebRtcTransport,
    dtlsParameters: DtlsParameters,
  ): Promise<void> {
    await transport.connect({ dtlsParameters });
  }

  // -------------------------------------
  // AUDIO Y VIDEO (PRODUCERS Y CONSUMERS)
  // -------------------------------------

  /**
   * @description Crea un productor de medios (audio o video) en un transporte WebRTC específico, utilizando los parámetros RTP proporcionados.
   * @param transport El transporte WebRTC en el que se desea crear el productor de medios.
   * @param kind El tipo de medio (audio o video) que se va a producir.
   * @param rtpParameters Los parámetros RTP necesarios para configurar el productor de medios.
   * @param appData Datos de aplicación opcionales que se pueden asociar al productor de medios.
   * @returns Un objeto de tipo Producer que representa el productor de medios creado en el transporte WebRTC especificado.
   */
  protected async createProducer<TAppData extends AppData = AppData>(
    transport: WebRtcTransport,
    kind: MediaKind,
    rtpParameters: RtpParameters,
    appData?: TAppData,
  ): Promise<Producer<TAppData>> {
    return await transport.produce({
      kind,
      rtpParameters,
      appData,
    });
  }

  /**
   * @description Crea un consumidor de medios (audio o video) en un transporte WebRTC específico,
   * consumiendo un productor de medios existente, utilizando las capacidades RTP del consumidor para verificar la compatibilidad.
   * @param roomId El ID de la sala SFU a la que pertenece el productor de medios que se desea consumir.
   * @param transport El transporte WebRTC en el que se desea crear el consumidor de medios.
   * @param producerId El ID del productor de medios que se desea consumir.
   * @param rtpCapabilities Las capacidades RTP del consumidor, que se utilizan para verificar la compatibilidad con el productor de medios antes de crear el consumidor.
   * @param appData Datos de aplicación opcionales que se pueden asociar al consumidor de medios.
   * @returns Un objeto de tipo Consumer que representa el consumidor de medios creado en el transporte WebRTC especificado.
   */
  protected async createConsumer<TAppData extends AppData = AppData>(
    roomId: string,
    transport: WebRtcTransport,
    producerId: string,
    rtpCapabilities: RtpCapabilities,
    appData?: TAppData,
  ): Promise<Consumer<TAppData>> {
    const router = this.roomManager.getRoom(roomId);

    // Verificar que el router puede consumir el productor
    // con las capacidades RTP del consumidor
    if (!router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error(
        "El cliente no soporta los codecs necesarios para consumir este stream.",
      );
    }

    return await transport.consume({
      producerId,
      rtpCapabilities,
      // Por defecto, los consumidores se crean en estado "paused" para evitar que el cliente reciba datos antes de estar listo.
      paused: true,
      appData,
    });
  }

  // -------------------------------------
  // DATA CHANNELS (DATA PRODUCERS Y DATA CONSUMERS)
  // -------------------------------------

  /**
   * @description Crea un productor de datos (data producer) en un transporte WebRTC específico, utilizando los parámetros de configuración proporcionados.
   * @param transport El transporte WebRTC en el que se desea crear el productor de datos.
   * @param appData Datos de aplicación opcionales que se pueden asociar al productor de datos.
   * @returns Un objeto de tipo DataProducer que representa el productor de datos creado en el transporte WebRTC especificado.
   */
  protected async createDataProducer<TAppData extends AppData = AppData>(
    transport: WebRtcTransport,
    appData?: TAppData,
  ): Promise<DataProducer<TAppData>> {
    return await transport.produceData({ appData });
  }

  /**
   * @description Crea un consumidor de datos (data consumer) en un transporte WebRTC específico,
   * consumiendo un productor de datos existente, utilizando los parámetros de configuración proporcionados.
   * @param transport El transporte WebRTC en el que se desea crear el consumidor de datos.
   * @param dataProducerId El ID del productor de datos que se desea consumir.
   * @param appData Datos de aplicación opcionales que se pueden asociar al consumidor de datos.
   * @returns Un objeto de tipo DataConsumer que representa el consumidor de datos creado en el transporte WebRTC especificado.
   */
  protected async createDataConsumer<TAppData extends AppData = AppData>(
    transport: WebRtcTransport,
    dataProducerId: string,
    appData?: TAppData,
  ): Promise<DataConsumer<TAppData>> {
    return await transport.consumeData({
      dataProducerId,
      appData,
    });
  }
}
