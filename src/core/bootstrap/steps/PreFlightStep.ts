import type { BootstrapContext, BootstrapStep } from "../BootstrapPipeline.js";
import { ScopeType, container } from "../../../container/DIContainer.js";
import {
  CONFIG_SERVICE_TOKEN,
  type ConfigService,
} from "../../../config/ConfigService.js";
import {
  INTERNAL_CONFIG_SERVICE_TOKEN,
  type InternalConfigService,
} from "../../../config/InternalConfigService.js";
import { DefaultConfigService } from "../../../config/DefaultConfigService.js";
import { validateAndLoadEnvironment } from "../env.bootstrap.js";

/**
 * @description Paso 1 del pipeline: Validación de entorno y configuración interna.
 *
 * Se ejecuta antes de crear la instancia de Fastify para asegurar que:
 * 1. La configuración distribuida esté disponible en el InternalConfigService inyectable.
 * 2. El ConfigService de usuario esté registrado para ConfigModule e @InjectConfig.
 * 3. Las variables de entorno sean válidas según el esquema proporcionado.
 *
 * Si la validación de entorno falla, el proceso se aborta inmediatamente.
 */
export class PreFlightStep implements BootstrapStep {
  readonly name = "PreFlightStep";

  async execute(ctx: BootstrapContext): Promise<void> {
    // Aseguramos que el ConfigService esté registrado en el contenedor DI
    // (puede haber sido limpiado por tests que llaman a container.clearAll())
    if (!container.has(CONFIG_SERVICE_TOKEN)) {
      container.registerClass(CONFIG_SERVICE_TOKEN, DefaultConfigService);
    }

    // Aseguramos que INTERNAL_CONFIG_SERVICE_TOKEN resuelva la misma instancia
    // que CONFIG_SERVICE_TOKEN (DefaultConfigService implementa ambas interfaces)
    if (!container.has(INTERNAL_CONFIG_SERVICE_TOKEN)) {
      container.registerFactory(
        INTERNAL_CONFIG_SERVICE_TOKEN,
        (c) => c.resolve(CONFIG_SERVICE_TOKEN),
        ScopeType.Singleton,
      );
    }

    // Registramos la configuración distribuida en el InternalConfigService
    const internalConfig = container.resolve<InternalConfigService>(INTERNAL_CONFIG_SERVICE_TOKEN);
    internalConfig.set("distributed", ctx.options.distributed || {});

    if (ctx.options.envSchema) {
      validateAndLoadEnvironment(ctx.options.envSchema);
    }
  }
}
