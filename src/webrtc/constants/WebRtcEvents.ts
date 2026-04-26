/**
 * @description Token para el evento de creación de sala WebRTC.
 * Se dispara cada vez que se crea una nueva sala SFU en el sistema.
 */
export const WEBRTC_ROOM_CREATED_EVENT = "webrtc:room:created";
export type WEBRTC_ROOM_CREATED_PAYLOAD = {
  roomId: string;
  workerPid: number;
};

/**
 * @description Token para el evento de cierre de sala WebRTC.
 * Se dispara cada vez que se cierra una sala SFU, ya sea por inactividad o por eliminación manual.
 */
export const WEBRTC_ROOM_CLOSED_EVENT = "webrtc:room:closed";
export type WEBRTC_ROOM_CLOSED_PAYLOAD = {
  roomId: string;
};

/**
 * @description Token para el evento de volúmenes de audio.
 * Se dispara periódicamente indicando los productores que están hablando en una sala.
 * (Solo esta implementado en los managers DEFAULT, si usas un manager personalizado,
 * debes emitirlo tú mismo desde el audioLevelObserver)
 */
export const WEBRTC_AUDIO_VOLUMES_EVENT = "webrtc:audio:volumes";
export type WEBRTC_AUDIO_VOLUMES_PAYLOAD = {
  roomId: string;
  volumes: {
    producerId: string;
    volume: number; // Volumen en dB, donde 0 es el volumen máximo y valores negativos indican niveles más bajos
  }[];
};

/**
 * @description Token para el evento de carga de workers de WebRTC.
 * Se dispara periódicamente indicando la carga actual de cada worker de mediasoup, lo que permite
 * implementar estrategias de balanceo de carga o monitoreo del rendimiento del sistema.
 * (Solo esta implementado en el manager AdvancedSfuRoomManager, si usas un manager personalizado,
 * debes emitirlo tú mismo)
 */
export const WEBRTC_WORKER_LOAD_EVENT = "webrtc:worker:load";
export type WEBRTC_WORKER_LOAD_PAYLOAD = {
  workers: {
    pid: number;
    cpuUsage: number;
    activeRooms: number;
  }[];
};

/**
 * @description Token para el evento de calidad de red de medios WebRTC.
 * Se dispara periódicamente indicando la calidad de la conexión de medios para cada productor
 * y consumidor en una sala, lo que permite implementar alertas o ajustes dinámicos en la calidad de transmisión.
 */
export const WEBRTC_MEDIA_SCORE_EVENT = "webrtc:media:score";
export type WEBRTC_MEDIA_SCORE_PAYLOAD = {
  roomId: string;
  producerId: string;
  socketId: string;
  /**
   * @description Puntuación de calidad de la conexión de medios, va del 0 al 10.
   */
  score: number;
};
