import {
  AudioLevelObserverOptions,
  RtpEncodingParameters,
} from "mediasoup/types";
import { IceServer } from "../../webrtc/interfaces/IceServer.js";

/**
 * @description Interfaz de configuración para el módulo de WebRTC en FastifyKit.
 * Permite configurar opciones como el puerto de escucha, IP pública, y si se debe usar un gateway por defecto.
 */
export interface FastifyKitWebRtcConfig {
  /** * Si es true, el framework inyectará y habilitará automáticamente el
   * DefaultWebRtcGateway sin que el usuario tenga que definirlo ni registrarlo manualmente
   */
  useDefaultGateway?: boolean;
  /** IP donde escuchará el servidor UDP/TCP de medios (Default: "0.0.0.0") */
  listenIp?: string;
  /** IP Pública que se enviará a los clientes para que puedan conectarse en producción */
  announcedIp?: string;
  /** Rango de puertos UDP para las conexiones RTP (Default: 40000-40099) */
  portRange?: {
    min: number;
    max: number;
  };
  /** Configuración de los servidores ICE */
  iceServers?: IceServer[];
  /** Configuración de las codificaciones de simulcast */
  simulcastEncodings?: RtpEncodingParameters[];
  /** Configuración de las codificaciones para compartir pantalla */
  screenSharingEncodings?: RtpEncodingParameters[];
  /** Configuración del observador de niveles de audio */
  audioLevelObserverOptions?: AudioLevelObserverOptions;
}
