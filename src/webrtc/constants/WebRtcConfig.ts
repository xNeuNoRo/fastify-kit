import { RtpCodecCapability, WorkerSettings } from "mediasoup/types";

/**
 * @description Lista de codecs optimizada para máxima compatibilidad.
 * Incluye soporte para VP8, H264 y sus respectivos mecanismos de retransmisión (RTX).
 */
export const MEDIA_CODECS: RtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus", // Opus es un codec de audio de alta calidad y baja latencia, ideal para videollamadas en tiempo real
    preferredPayloadType: 111,
    clockRate: 48000,
    channels: 2,
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

export const WORKER_SETTINGS: WorkerSettings = {
  rtcMinPort: 10000, // Puerto mínimo para las conexiones WebRTC
  rtcMaxPort: 10100, // Puerto máximo para las conexiones WebRTC
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
