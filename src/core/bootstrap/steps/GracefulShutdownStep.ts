import type { BootstrapContext, BootstrapStep } from "../BootstrapPipeline.js";
import { setupGracefulShutdown } from "../lifecycle.bootstrap.js";

/**
 * @description Paso 7 del pipeline: Configuración del apagado (Graceful Shutdown).
 *
 * Intercepta las señales SIGTERM y SIGINT del sistema operativo.
 * Cuando se recibe una señal:
 * 1. Almacena qué señal se recibió en el contexto (para pasarla a los hooks de shutdown).
 * 2. Cierra la instancia de Fastify, lo que dispara los hooks onClose registrados.
 * 3. Sale del proceso con código 0 (éxito) o 1 (error).
 *
 * Este paso DEBE ser el último del pipeline.
 */
export class GracefulShutdownStep implements BootstrapStep {
  readonly name = "GracefulShutdownStep";

  async execute(ctx: BootstrapContext): Promise<void> {
    // Configuración para interceptar SIGTERM/SIGINT antes de que Fastify cierre el servidor,
    // Esto disparará app.close() que a su vez ejecutará los hooks de arriba.
    setupGracefulShutdown(ctx.app, (signal) => {
      ctx.receivedSignal = signal;
    });
  }
}
