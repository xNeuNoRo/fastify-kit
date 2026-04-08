import * as fs from "node:fs/promises";
import { HealthIndicator } from "./HealthIndicator.js";
import type { HealthIndicatorResult } from "../interfaces.js";

export class DiskSpaceHealthIndicator extends HealthIndicator {
  /**
   * @param key Identificador (defecto: "disk_space")
   * @param path El disco a verificar (defecto: "/")
   * @param minFreeSpaceMB Mínimo de Megabytes libres requeridos (defecto: 250MB)
   */
  async check(
    key: string = "disk_space",
    path: string = "/",
    minFreeSpaceMB: number = 250,
  ): Promise<HealthIndicatorResult> {
    try {
      const stat = await fs.statfs(path);
      // bavail = bloques disponibles para usuarios no root, bsize = tamaño del bloque
      const freeSpaceBytes = stat.bavail * stat.bsize;
      // Convertimos a MB para una lectura más amigable
      const freeSpaceMB = Math.round(freeSpaceBytes / 1024 / 1024);
      // El sistema es saludable si el espacio libre es mayor o igual al mínimo requerido
      const isHealthy = freeSpaceMB >= minFreeSpaceMB;

      // Construimos el resultado con la información relevante y un mensaje de error si no es saludable
      return this.getStatus(key, isHealthy, {
        freeMB: freeSpaceMB,
        minRequiredMB: minFreeSpaceMB,
        path,
        ...(isHealthy
          ? {}
          : {
              error: `Low disk space (${freeSpaceMB}MB < ${minFreeSpaceMB}MB)`,
            }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.getStatus(key, false, { error: message, path });
    }
  }
}
