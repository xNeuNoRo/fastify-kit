import type { BootstrapContext, BootstrapStep } from "../BootstrapPipeline.js";
import { registerCorePlugins } from "../plugins.bootstrap.js";

/**
 * @description Paso 4 del pipeline: Registro de plugins esenciales de Fastify.
 *
 * Registra en la instancia de Fastify los plugins según las opciones del usuario:
 * - Multipart (manejo de archivos)
 * - Cookies
 * - JWT (autenticación por tokens)
 * - WebSockets
 * - Static assets
 * - Plugins internos (request context, error handler)
 * - Plugins de seguridad (CORS, Helmet, rate limit)
 * - Documentación (Swagger/Scalar)
 */
export class CorePluginsStep implements BootstrapStep {
  readonly name = "CorePluginsStep";

  async execute(ctx: BootstrapContext): Promise<void> {
    // Registramos los plugins esenciales
    await registerCorePlugins(ctx.app, ctx.options);
  }
}
