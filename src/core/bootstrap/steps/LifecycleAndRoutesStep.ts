import { container } from "../../../container/DIContainer.js";
import type { Constructor } from "../../../http/routing/scanner/index.js";
import { registerControllers } from "../../../http/routing/scanner/index.js";
import type { BootstrapContext, BootstrapStep } from "../BootstrapPipeline.js";
import {
  hasLifecycleHook,
  executeLifecycleHook,
  setupScheduledTasks,
  registerWebSocketGateways,
} from "../lifecycle.bootstrap.js";

/**
 * @description Paso 5 del pipeline: Colección de instancias de ciclo de vida,
 * hooks onModuleInit, registro de controladores, WebSocket gateways y tareas programadas.
 *
 * Ejecuta en orden:
 * 1. Recolecta las instancias que implementan hooks de ciclo de vida.
 * 2. Ejecuta onModuleInit antes de que se registre cualquier plugin o ruta.
 * 3. Registra los controladores descubiertos con el prefijo global configurado.
 * 4. Registra los gateways de WebSocket (si están activados).
 * 5. Configura las tareas programadas (cron jobs).
 */
export class LifecycleAndRoutesStep implements BootstrapStep {
  readonly name = "LifecycleAndRoutesStep";

  async execute(ctx: BootstrapContext): Promise<void> {
    // Set para almacenar las instancias de los controladores y proveedores
    // que implementen hooks de ciclo de vida, para luego ejecutar esos hooks en el orden correcto.
    ctx.lifecycleInstances = new Set<object>();

    // Recorremos los controladores y providers para agregarlos al set de instancias de ciclo de vida.
    for (const Controller of ctx.allControllers) {
      if (hasLifecycleHook(Controller)) {
        ctx.lifecycleInstances.add(container.resolve(Controller));
      }
    }
    for (const provider of ctx.allProviders) {
      if (hasLifecycleHook(provider.implementation)) {
        ctx.lifecycleInstances.add(
          container.resolve(provider.token as Constructor),
        );
      }
    }

    // Ejecutamos el lifecycle hook onModuleInit antes de que se registre cualquier plugin o ruta en Fastify
    await executeLifecycleHook(ctx.lifecycleInstances, "onModuleInit");

    // Registramos los controladores escaneados con el prefijo global configurado (si se proporciona) para organizar mejor las rutas de la API
    const prefix = ctx.options.globalPrefix || "";
    await ctx.app.register(
      async (instance) => {
        await registerControllers(instance, ctx.allControllers);
      },
      { prefix },
    );

    // Si el usuario ha activado el soporte para WebSockets, buscamos en todos los controladores
    // y proveedores registrados aquellos que tengan el decorador @WebSocketGateway y los registramos utilizando la función registerGateways.
    if (ctx.options.websockets) {
      registerWebSocketGateways(ctx.app, ctx.allControllers, ctx.allProviders);
    }

    // Finalmente, configuramos las tareas programadas (cron jobs)
    // definidas en los proveedores de los módulos. Esto se hace al final
    // para asegurarnos de que todos los proveedores estén registrados e
    // instanciados correctamente antes de iniciar las tareas programadas.
    setupScheduledTasks(ctx.app, ctx.allProviders);
  }
}
