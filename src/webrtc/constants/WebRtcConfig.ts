import {
  RtpCodecCapability,
  RtpEncodingParameters,
  WebRtcServerOptions,
  WorkerSettings,
  WebRtcTransportOptions,
  AudioLevelObserverOptions,
  RouterOptions,
} from "mediasoup/types";
import { IceServer } from "../interfaces/IceServer.js";
import { ConfigRegistry } from "../../config/ConfigRegistry.js";
import { FastifyKitWebRtcConfig } from "../../core/interfaces/webrtc.interface.js";

/**
 * @description Lista de codecs optimizada para máxima compatibilidad.
 * Incluye soporte para VP8, H264 y sus respectivos mecanismos de retransmisión (RTX).
 */
export const DEFAULT_MEDIA_CODECS: RtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus", // Opus es un codec de audio de alta calidad y baja latencia, ideal para videollamadas en tiempo real
    preferredPayloadType: 111,
    clockRate: 48000,
    channels: 2,
    parameters: {
      useinbandfec: 1, // FEC en banda: mejora la calidad de audio en conexiones inestables al permitir la corrección de errores sin necesidad de retransmisiones
      usedtx: 1, // DTX: permite la detección de silencio y la reducción de la tasa de bits durante los períodos de silencio, lo que ahorra ancho de banda y mejora la eficiencia en conexiones con limitaciones de ancho de banda
    },
  },
  {
    kind: "video", // VP8 es un codec de video ampliamente compatible y eficiente para videollamadas en tiempo real
    mimeType: "video/VP8",
    preferredPayloadType: 96,
    clockRate: 90000,
    parameters: {
      "x-google-start-bitrate": 1000,
    },
  },
  {
    kind: "video",
    mimeType: "video/rtx", // Retransmision para VP8 en caso de perdida de paquetes
    preferredPayloadType: 97,
    clockRate: 90000,
    parameters: {
      apt: 96,
    },
  },
  {
    kind: "video",
    mimeType: "video/H264", // H264 es otro codec de video ampliamente compatible, especialmente en dispositivos móviles y navegadores mas viejos
    preferredPayloadType: 125,
    clockRate: 90000,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "42e01f", // Este perfil es compatible con la mayoría de los navegadores y dispositivos
      "level-asymmetry-allowed": 1, // Permite la negociación de niveles asimétricos entre el emisor y el receptor
      "x-google-start-bitrate": 1000, // Configura una tasa de bits inicial para mejorar la calidad de video al inicio de la transmisión
    },
  },
  {
    kind: "video",
    mimeType: "video/rtx", // Retransmision para H264 en caso de perdida de paquetes
    preferredPayloadType: 126,
    clockRate: 90000,
    parameters: {
      apt: 125,
    },
  },
];

/**
 * @description Configuración de simulcast optimizada para videollamadas en tiempo real.
 * Incluye tres niveles de calidad para adaptarse a diferentes condiciones de red y capacidades de dispositivos.
 * - r0: Bajo bitrate para conexiones débiles o ancho de banda limitado.
 * - r1: Bitrate medio para conexiones promedio o dispositivos móviles.
 * - r2: Alto bitrate para conexiones fuertes o dispositivos de escritorio con buena capacidad de procesamiento.
 */
export const DEFAULT_SIMULCAST_ENCODINGS: RtpEncodingParameters[] = [
  // scalabilityMode "L1T3" significa que se generan tres capas de temporalidad (T) con una sola capa espacial (L),
  // traducido en otras palabras significa que se generan tres versiones del mismo video con diferentes tasas de bits,
  // pero todas con la misma resolución, lo que es ideal para adaptarse a diferentes condiciones de red
  // sin requerir múltiples capas espaciales, lo que simplifica la implementación y mejora la compatibilidad.
  { rid: "r0", maxBitrate: 100000, scalabilityMode: "L1T3" }, // Bajo bitrate - Conexiones debiles o ancho de banda limitado
  { rid: "r1", maxBitrate: 300000, scalabilityMode: "L1T3" }, // Bitrate medio - Conexiones promedio o para dispositivos móviles
  { rid: "r2", maxBitrate: 900000, scalabilityMode: "L1T3" }, // Alto bitrate - Conexiones fuertes o para dispositivos de escritorio con buena capacidad de procesamiento
];

/**
 * @description Obtiene las codificaciones de simulcast configuradas o las por defecto.
 */
export const getSimulcastEncodings = (): RtpEncodingParameters[] => {
  const config =
    ConfigRegistry.get<FastifyKitWebRtcConfig>("webrtc_user_config");
  return config?.simulcastEncodings || DEFAULT_SIMULCAST_ENCODINGS;
};

/**
 * @description Configuración de simulcast optimizada para compartir pantalla.
 * Dado que el contenido de la pantalla suele ser más estático y menos sensible a la latencia que el video de la cámara,
 * se puede configurar con un bitrate más alto para mejorar la calidad visual.
 * En este caso, se utiliza una sola capa de temporalidad (L1T3) con un bitrate máximo de 1.5 Mbps,
 * lo que es adecuado para la mayoría de las situaciones de compartición de pantalla sin requerir múltiples capas espaciales.
 */
export const DEFAULT_SCREEN_SHARING_ENCODINGS: RtpEncodingParameters[] = [
  // dtx: true permite la detección de silencio y la reducción de la tasa de bits durante
  // los períodos de silencio, lo que ahorra ancho de banda y mejora la eficiencia en conexiones con limitaciones de ancho de banda.
  { dtx: true, maxBitrate: 1500000, scalabilityMode: "L1T3" },
];

/**
 * @description Obtiene las codificaciones para compartir pantalla configuradas o las por defecto.
 */
export const getScreenSharingEncodings = (): RtpEncodingParameters[] => {
  const config =
    ConfigRegistry.get<FastifyKitWebRtcConfig>("webrtc_user_config");
  return config?.screenSharingEncodings || DEFAULT_SCREEN_SHARING_ENCODINGS;
};

/**
 * @description Configuración de transporte WebRTC optimizada para videollamadas en tiempo real.
 * Esta configuración está diseñada para proporcionar una experiencia de videollamada fluida y de alta calidad,
 * incluso en condiciones de red variables, al establecer un bitrate inicial razonable, optimizar la configuración de SCTP para DataChannels,
 * y habilitar características esenciales para la comunicación de datos en tiempo real.
 */
export const DEFAULT_TRANSPORT_OPTIONS: Partial<WebRtcTransportOptions> = {
  // 1 Mbps inicial para evitar lag al conectar y permitir una adaptación rápida a la calidad de la red
  initialAvailableOutgoingBitrate: 1000000,
  // Configuración de SCTP para DataChannels optimizada para la mayoría de los casos de uso sin sobrecargar la conexión
  numSctpStreams: { OS: 1024, MIS: 1024 },
  // Tamaño máximo para DataChannels (mensajes) en 256 KB, lo que es suficiente para la mayoría de los casos de uso sin sobrecargar la conexión
  maxSctpMessageSize: 262144,
  // Tamaño del buffer de envío SCTP para DataConsumers, también configurado en 256 KB para mantener la eficiencia sin saturar la conexión
  sctpSendBufferSize: 262144,
  // Habilitar SCTP para permitir el uso de DataChannels, lo que es esencial para la comunicación de datos en tiempo real en WebRTC
  enableSctp: true,
};

/**
 * @description Configuración del Servidor WebRTC para compartir puertos.
 * announcedIp debe ser la IP pública real del servidor para que el handshake ICE funcione.
 * Estos valores se pueden sobrescribir dinámicamente a través del ConfigRegistry,
 * lo que permite una configuración flexible en diferentes entornos de despliegue sin necesidad de recompilar el código.
 */
export const getWebRtcServerOptions = (): WebRtcServerOptions => {
  const config =
    ConfigRegistry.get<FastifyKitWebRtcConfig>("webrtc_user_config") || {};

  // Valores dinámicos con fallback a los defaults de siempre
  const listenIp = config.listenIp || "0.0.0.0";
  const announcedIp = config.announcedIp || "127.0.0.1";
  const portRange = config.portRange || {
    min: 40000,
    max: 40099,
  };

  return {
    listenInfos: [
      {
        protocol: "udp",
        ip: listenIp,
        announcedAddress: announcedIp,
        portRange,
      },
      {
        protocol: "tcp",
        ip: listenIp,
        announcedAddress: announcedIp,
        portRange,
      },
    ],
  };
};

/**
 * @description Lista de servidores ICE optimizada para máxima compatibilidad y disponibilidad.
 * Incluye servidores STUN públicos de Google y Cloudflare, que son ampliamente utilizados
 * y confiables para la mayoría de las aplicaciones WebRTC.
 * Estos servidores permiten a los clientes descubrir su dirección IP pública y establecer conexiones a través
 * de NATs y firewalls, lo que es esencial para el funcionamiento de WebRTC en entornos reales.
 */
export const DEFAULT_ICE_SERVERS: IceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

/**
 * @description Obtiene la lista de servidores ICE configurados.
 * Si el usuario no definió ninguno en FastifyKit.create(), devuelve los defaults.
 */
export const getIceServers = (): IceServer[] => {
  const config =
    ConfigRegistry.get<FastifyKitWebRtcConfig>("webrtc_user_config");
  // Si el usuario configuró servidores propios, los usamos; si no, los públicos de Google/Cloudflare
  return config?.iceServers || DEFAULT_ICE_SERVERS;
};

/**
 * @description Configuración para el observador de niveles de audio.
 * Permite al SFU detectar quién está hablando sin decodificar el audio.
 */
export const DEFAULT_AUDIO_LEVEL_OBSERVER_OPTIONS: AudioLevelObserverOptions = {
  // Solo reportar el hablante más activo para reducir la carga de procesamiento
  // y simplificar la lógica de selección de hablante
  maxEntries: 1,
  // Umbral de nivel de audio en dB para considerar a alguien como hablante activo,
  // ajustado para detectar voces normales sin incluir ruido de fondo
  threshold: -45,
  // Intervalo de tiempo en ms para actualizar el nivel de audio,
  // lo que permite una detección rápida de cambios en el hablante activo
  interval: 800,
};

/**
 * @description Obtiene las opciones del observador de audio configuradas o las por defecto.
 */
export const getAudioLevelObserverOptions = (): AudioLevelObserverOptions => {
  const config =
    ConfigRegistry.get<FastifyKitWebRtcConfig>("webrtc_user_config");
  return (
    config?.audioLevelObserverOptions || DEFAULT_AUDIO_LEVEL_OBSERVER_OPTIONS
  );
};

/**
 * @description Configuración del Worker de mediasoup optimizada para un entorno de producción.
 */
export const DEFAULT_WORKER_SETTINGS: WorkerSettings = {
  logLevel: "warn", // Nivel de registro para el worker
  logTags: [
    "info", // Etiqueta de registro para información general sobre el funcionamiento del worker
    "ice", // Etiqueta de registro para eventos relacionados con ICE (Interactive Connectivity Establishment), que es el proceso de establecimiento de conexiones en WebRTC
    "dtls", // Etiqueta de registro para eventos relacionados con DTLS (Datagram Transport Layer Security), que es el protocolo de seguridad utilizado en WebRTC
    "rtp", // Etiqueta de registro para eventos relacionados con RTP (Real-time Transport Protocol), que es el protocolo para la transmisión de datos en tiempo real
    "srtp", // Etiqueta de registro para eventos relacionados con SRTP (Secure Real-time Transport Protocol), que es el protocolo de seguridad para la transmisión de datos en tiempo real
    "rtcp", // Etiqueta de registro para eventos relacionados con RTCP (Real-time Control Protocol), que es el protocolo para el control y la calidad de la transmisión en tiempo real
    "rtx", // Etiqueta de registro para eventos relacionados con RTX (Retransmission), que es el mecanismo para la retransmisión de paquetes perdidos
  ],
};

/**
 * @description Configuración del router de mediasoup optimizada para un entorno de producción.
 */
export const DEFAULT_ROUTER_OPTIONS: RouterOptions = {
  mediaCodecs: DEFAULT_MEDIA_CODECS,
  appData: {
    framework: "@neunoro/fastify-kit",
    author: "Angel Gonzalez M. (NeuNoRo)",
    version: "1.0.0",
  },
};
