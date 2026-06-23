import type { BootstrapContext, BootstrapStep } from "../BootstrapPipeline.js";
import { container } from "../../../container/DIContainer.js";
import {
  CONFIG_SERVICE_TOKEN,
  type ConfigService,
} from "../../../config/ConfigService.js";
import { validateAndLoadEnvironment } from "../env.bootstrap.js";

/**
 * @description Paso 1 del pipeline: Validación de entorno y configuración interna.
 *
 * Se ejecuta antes de crear la instancia de Fastify para asegurar que:
 * 1. La configuración distribuida esté disponible en el ConfigService inyectable.
 * 2. Las variables de entorno sean válidas según el esquema proporcionado.
 *
 * Si la validación de entorno falla, el proceso se aborta inmediatamente.
 */
export class PreFlightStep implements BootstrapStep {
  readonly name = "PreFlightStep";

  async execute(ctx: BootstrapContext): Promise<void> {
    // Registramos la configuracion distribuida en el ConfigService para que los adapters/managers puedan usarla
    const configService = container.resolve<ConfigService>(CONFIG_SERVICE_TOKEN);
    configService.set("distributed", ctx.options.distributed || {});

    if (ctx.options.envSchema) {
      validateAndLoadEnvironment(ctx.options.envSchema);
    }
  }
}
