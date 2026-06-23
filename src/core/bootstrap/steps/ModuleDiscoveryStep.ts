import { container } from "../../../container/DIContainer.js";
import type { BootstrapContext, BootstrapStep } from "../BootstrapPipeline.js";
import { bootstrapModule } from "../discovery.bootstrap.js";
import {
  initializeCqrsModule,
  initializeWebRtcModule,
  initializeQueueModule,
  initializeDistributedModule,
} from "../modules.bootstrap.js";

/**
 * @description Paso 3 del pipeline: Descubrimiento de módulos e inicialización de subsistemas.
 *
 * Ejecuta en orden:
 * 1. Escanea el árbol de módulos para descubrir controladores y proveedores.
 * 2. Inicializa el subsistema de CQRS (Mediator).
 * 3. Inicializa el subsistema de WebRTC (si está activado).
 * 4. Inicializa el subsistema de colas/BackgroundJobs (si está configurado).
 * 5. Inicializa el subsistema distribuido (Redis, EventBus, etc.).
 * 6. Registra la instancia de Fastify en el contenedor DI.
 */
export class ModuleDiscoveryStep implements BootstrapStep {
  readonly name = "ModuleDiscoveryStep";

  async execute(ctx: BootstrapContext): Promise<void> {
    // Escaneamos todos los módulos y submódulos para obtener la lista completa de controladores a registrar en Fastify.
    const { allControllers, allProviders } = await bootstrapModule(
      ctx.options.module,
    );

    ctx.allControllers = allControllers;
    ctx.allProviders = allProviders;

    // Inicializamos el módulo de CQRS integrado en FastifyKit
    await initializeCqrsModule(ctx.allProviders);

    // Inicializamos el módulo de WebRTC integrado en FastifyKit
    await initializeWebRtcModule(ctx.options, ctx.allProviders);

    // Inicializamos el módulo de colas (BackgroundJobs)
    await initializeQueueModule(
      ctx.options,
      ctx.allControllers,
      ctx.allProviders,
    );

    // Inicializamos el módulo distribuido (EventBus, etc.)
    await initializeDistributedModule(ctx.options, ctx.allProviders);

    // Registramos la instancia de Fastify en el contenedor de inyección de dependencias para que pueda ser inyectada en cualquier controlador o proveedor utilizando el token FASTIFY_INSTANCE_TOKEN.
    const { FASTIFY_INSTANCE_TOKEN } = await import("../../FastifyKit.js");
    container.registerInstance(FASTIFY_INSTANCE_TOKEN, ctx.app);
  }
}
