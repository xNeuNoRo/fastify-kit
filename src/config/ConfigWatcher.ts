import { watch, type FSWatcher } from "chokidar";
import { getLogger } from "../logger/logger.factory.js";

/**
 * @description Observador de cambios de archivos de configuración.
 * Permite hot-reload de configuración sin reiniciar la aplicación.
 * Usa chokidar para monitorear cambios en archivos y debounce configurable.
 *
 * Solo debe activarse en entornos de desarrollo (NODE_ENV !== "production").
 */
export class ConfigWatcher {
  private readonly logger = getLogger();
  private watcher: FSWatcher | null = null;
  private readonly debounceMs: number;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param debounceMs Tiempo en ms para debouncear cambios rápidos consecutivos.
   * @default 500
   */
  constructor(debounceMs: number = 500) {
    this.debounceMs = debounceMs;
  }

  /**
   * @description Comienza a observar los archivos especificados.
   * Cuando un archivo cambia, ejecuta el callback onChange con debounce.
   *
   * @param files Array de paths (glob patterns) a observar.
   * @param onChange Callback que recibe el path del archivo cambiado.
   */
  watch(files: string[], onChange: (filePath: string) => void): void {
    // Si ya hay un watcher activo, lo detenemos antes de crear uno nuevo
    this.unwatch();

    this.logger.info(
      `[FastifyKit ConfigWatcher] Observando cambios en ${files.length} archivo(s)...`,
    );

    this.watcher = watch(files, {
      ignoreInitial: true,
      persistent: false, // No mantener el proceso vivo solo por el watcher
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    this.watcher.on("change", (filePath: string) => {
      // Debounceamos cambios consecutivos para evitar múltiples recargas
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        this.logger.info(
          `[FastifyKit ConfigWatcher] Cambio detectado en: ${filePath}`,
        );
        onChange(filePath);
      }, this.debounceMs);
    });

    this.watcher.on("error", (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `[FastifyKit ConfigWatcher] Error observando archivos: ${err.message}`,
        { error: err },
      );
    });
  }

  /**
   * @description Detiene el watcher y limpia los listeners.
   */
  unwatch(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
