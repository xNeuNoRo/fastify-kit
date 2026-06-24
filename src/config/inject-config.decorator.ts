import {
  CONFIG_SERVICE_TOKEN,
  type ConfigService,
} from "./ConfigService.js";
import { ConfigRegistry } from "./ConfigRegistry.js";
import { container } from "../container/DIContainer.js";

/**
 * @description Decorador de campo para inyectar configuraciones desde el ConfigService inyectable.
 * Resuelve ConfigService del contenedor DI y accede a la config por namespace.
 * Si ConfigService no está registrado, fallback a ConfigRegistry (deprecado).
 *
 * @param namespace El namespace bajo el cual se ha registrado la configuración en el ConfigService.
 * @example
 * ```typescript
 * // Primero debes inicializar ConfigModule.forRoot() con el schema
 * ConfigModule.forRoot({
 *   schema: Type.Object({
 *     DATABASE_URL: Type.String(),
 *     PORT: Type.Number({ default: 3000 }),
 *   })
 * });
 *
 * // Luego puedes inyectar la config en cualquier clase
 * class MyService {
 *   \@InjectConfig("DATABASE_URL")
 *   private readonly dbUrl: string;
 * }
 * ```
 * @remarks Es importante asegurarse de que ConfigModule.forRoot() se haya llamado antes de inyectar la configuración.
 * Si ConfigService no está registrado en el DI (no se llamó ConfigModule.forRoot()), se usa el fallback a ConfigRegistry
 * con un warning de deprecación.
 * @returns Una función que se ejecutará cada vez que se acceda al campo decorado,
 * retornando la configuración registrada bajo el namespace especificado.
 */
export function InjectConfig(namespace: string) {
  return function <This, Value>(
    _target: undefined,
    context: ClassFieldDecoratorContext<This, Value>,
  ) {
    if (context.kind !== "field") {
      throw new Error(
        "@InjectConfig solo puede ser aplicado a campos de clase",
      );
    }

    // Este initializer recibe el valor que se le haya asignado por defecto a la variable
    return function (this: This, initialValue: Value) {
      // Intentamos resolver ConfigService del contenedor DI (registrado por ConfigModule.forRoot())
      if (container.has(CONFIG_SERVICE_TOKEN)) {
        const configService = container.resolve<ConfigService>(CONFIG_SERVICE_TOKEN);
        // Si la config existe en ConfigService, la usamos.
        if (configService.hasConfig(namespace)) {
          return configService.getConfig(namespace) as Value;
        }
        // Si no existe en ConfigService, seguimos al fallback (ConfigRegistry)
      }

      // Fallback: ConfigRegistry (deprecado, se eliminará en futuras versiones)
      const config = ConfigRegistry.get(namespace);
      return (config === undefined ? initialValue : config) as Value;
    };
  };
}
