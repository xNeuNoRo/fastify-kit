import type { BootstrapContext, BootstrapStep } from "../BootstrapPipeline.js";
import { executeLifecycleHook } from "../lifecycle.bootstrap.js";

/**
 * @description Paso 6 del pipeline: Hooks de ciclo de vida posteriores al registro de rutas.
 *
 * Registra los hooks de Fastify para los eventos de ciclo de vida:
 * 1. onApplicationBootstrap: justo antes de que el servidor comience a escuchar.
 * 2. onServerReady: justo después de que el servidor ya está escuchando en el puerto.
 * 3. onClose: ejecuta beforeApplicationShutdown y onApplicationShutdown al cerrar el servidor.
 */
export class BootstrapHooksStep implements BootstrapStep {
  readonly name = "BootstrapHooksStep";

  async execute(ctx: BootstrapContext): Promise<void> {
    // Inicializamos el hook onApplicationBootstrap justo antes de que el servidor comience a escuchar peticiones.
    await executeLifecycleHook(
      ctx.lifecycleInstances,
      "onApplicationBootstrap",
    );

    // Inicializamos el hook onServerReady justo después de que el servidor ya está escuchando en el puerto
    ctx.app.addHook("onListen", async () => {
      await executeLifecycleHook(ctx.lifecycleInstances, "onServerReady");
    });

    // Inicializamos el hook onApplicationShutdown justo antes de que el servidor se cierre,
    // pasando la señal recibida para que las instancias puedan realizar tareas de limpieza
    // o sacar el nodo de un Load Balancer antes de que deje de aceptar nuevas peticiones.
    ctx.app.addHook("onClose", async () => {
      // Primero ejecutamos el hook "before" para limpieza de infraestructura
      await executeLifecycleHook(
        ctx.lifecycleInstances,
        "beforeApplicationShutdown",
        ctx.receivedSignal,
      );

      // Luego el hook final de apagado
      await executeLifecycleHook(
        ctx.lifecycleInstances,
        "onApplicationShutdown",
        ctx.receivedSignal,
      );
    });
  }
}
