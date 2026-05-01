/**
 * @description Tipos relacionados con la configuración de ICE servers para WebRTC.
 * Estos tipos se utilizan para definir la estructura de los objetos que representan los servidores ICE,
 * que son esenciales para el establecimiento de conexiones WebRTC, especialmente en entornos con NAT o firewalls.
 */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}
