import type { BootstrapContext, BootstrapStep } from "../BootstrapPipeline.js";
import { InternalConfig } from "../../../config/InternalConfig.js";
import { validateAndLoadEnvironment } from "../env.bootstrap.js";

/**
 * @description Paso 1 del pipeline: Validación de entorno y configuración interna.
 *
 * Se ejecuta antes de crear la instancia de Fastify para asegurar que:
 * 1. La configuración distribuida esté disponible en el registry interno.
 * 2. Las variables de entorno sean válidas según el esquema proporcionado.
 *
 * Si la validación de entorno falla, el proceso se aborta inmediatamente.
 */
export class PreFlightStep implements BootstrapStep {
  readonly name = "PreFlightStep";

  async execute(ctx: BootstrapContext): Promise<void> {
    // Registramos la configuracion distribuida en el registry interno para que los adapters/managers puedan usarla
    InternalConfig.set("distributed", ctx.options.distributed || {});

    if (ctx.options.envSchema) {
      validateAndLoadEnvironment(ctx.options.envSchema);
    }
  }
}
