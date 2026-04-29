import type { StaticFileOptions } from "../interfaces/static.interface.js";

/**
 * @description Representa un archivo estático que será servido por FastifyKit.
 * Retorna una instancia de esta clase desde un controlador para delegar
 * el streaming seguro y optimizado al motor interno del framework.
 * @example
 * return new StaticFile("reporte.pdf", {
 *  root: "/archivos/seguros",
 *  attachment: true
 * });
 */
export class StaticFile {
  /**
   * @param filename El nombre del archivo a buscar (ej. "video-01.mp4")
   * @param options Opciones de configuración (directorio raíz, forzar descarga, fallback)
   */
  constructor(
    public readonly filename: string,
    public readonly options: StaticFileOptions,
  ) {}
}
