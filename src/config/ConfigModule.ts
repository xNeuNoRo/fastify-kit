import { TSchema } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { ConfigValidator, ConfigValidationError } from "./ConfigValidator.js";
import { ConfigWatcher } from "./ConfigWatcher.js";
import { getLogger } from "../logger/logger.factory.js";
import { ScopeType, container } from "../container/DIContainer.js";
import { CONFIG_SERVICE_TOKEN, type ConfigService } from "./ConfigService.js";
import { INTERNAL_CONFIG_SERVICE_TOKEN } from "./InternalConfigService.js";
import { DefaultConfigService } from "./DefaultConfigService.js";

/**
 * @description Opciones de configuración para ConfigModule.forRoot().
 */
export interface ConfigModuleOptions {
  /**
   * Esquema TypeBox para validar la configuración de la aplicación.
   * Define los tipos, requerimientos y valores por defecto de cada variable.
   */
  schema: TSchema;
  /**
   * Activar hot-reload de configuración (observa cambios en archivos).
   * Solo se activa si NODE_ENV !== "production".
   * @default false
   */
  hotReload?: boolean;
  /**
   * Tiempo en ms para debouncear cambios rápidos consecutivos.
   * @default 500
   */
  watchDebounce?: number;
  /**
   * Si es true, lanza error en claves desconocidas (typos, vars no documentadas).
   * Si es false, solo valida las claves conocidas e ignora el resto.
   * @default true
   */
  strict?: boolean;
  /**
   * Prefijo para filtrar variables de entorno.
   * Ej: "MYAPP_" → solo valida vars con ese prefijo
   * @default "" (sin prefijo)
   */
  envPrefix?: string;
}

/**
 * @description Módulo de configuración de FastifyKit.
 *
 * Proporciona validación de configuración con TypeBox, coerción de tipos,
 * registro en el contenedor DI y hot-reload opcional para desarrollo.
 *
 * @example
 * // En el punto de entrada de la aplicación, ANTES de FastifyKit.create():
 * ConfigModule.forRoot({
 *   schema: Type.Object({
 *     DATABASE_URL: Type.String(),
 *     PORT: Type.Number({ default: 3000 }),
 *     DEBUG: Type.Boolean({ default: false }),
 *   }),
 *   envPrefix: "MYAPP_",
 *   hotReload: process.env.NODE_ENV !== "production",
 * });
 */
export class ConfigModule {
  /**
   * @description Inicializa el sistema de configuración validando el entorno
   * contra un esquema TypeBox y registrando ConfigService en el contenedor DI.
   *
   * Debe llamarse ANTES de FastifyKit.create() para que todos los providers
   * puedan inyectar ConfigService y acceder a la configuración validada.
   *
   * @param options Opciones de configuración del módulo.
   * @returns void
   */
  static forRoot(options: ConfigModuleOptions): void {
    const logger = getLogger();
    const strict = options.strict ?? true;
    const envPrefix = options.envPrefix ?? "";

    // Extraemos solo las variables de entorno relevantes según el prefijo
    const extractedEnv: Record<string, unknown> = {};
    const schemaKeys = Object.keys((options.schema as any).properties || {});

    for (const key of schemaKeys) {
      const envKey = envPrefix ? `${envPrefix}${key}` : key;
      if (process.env[envKey] !== undefined) {
        extractedEnv[key] = process.env[envKey];
      }
    }

    // Coercionamos los valores según el esquema (ej: "3000" → 3000)
    const coerced = ConfigValidator.coerce(options.schema, extractedEnv);

    // Compilamos el esquema para validación rápida
    const compiler = TypeCompiler.Compile(options.schema);

    // Validamos contra el esquema
    if (!compiler.Check(coerced)) {
      const errors = [...compiler.Errors(coerced)].map((e) => ({
        path: e.path,
        message: e.message,
        value: e.value,
      }));

      console.error(
        "[FastifyKit ConfigModule] Ha fallado la validación de configuración:",
      );
      for (const err of errors) {
        console.error(
          `  - Variable: ${err.path.replace("/", "")} | Mensaje: ${err.message}`,
        );
      }
      // Evitamos inicializar el servidor hasta que se configuren debidamente
      console.error(
        "Abortando la inicialización del servidor por configuración inválida.",
      );
      throw new ConfigValidationError(
        "Validación de configuración fallida",
        errors,
      );
    }

    // Verificamos claves desconocidas si strict está activado
    if (strict) {
      // Extraemos todas las variables de entorno que coincidan con el prefijo (o sin prefijo)
      const rawEnvKeys: Record<string, unknown> = {};
      for (const envKey of Object.keys(process.env)) {
        if (envPrefix) {
          if (!envKey.startsWith(envPrefix)) continue;
        } else {
          // Sin prefijo, solo consideramos vars con formato de config (MAYUSCULAS_CON_GUIONES)
          if (!/^[A-Z][A-Z0-9_]*$/.test(envKey)) continue;
        }
        const key = envPrefix ? envKey.slice(envPrefix.length) : envKey;
        rawEnvKeys[key] = process.env[envKey];
      }
      const unknownKeys = ConfigValidator.findUnknownKeys(
        options.schema,
        rawEnvKeys,
      );
      if (unknownKeys.length > 0) {
        console.error(
          "[FastifyKit ConfigModule] Se detectaron variables de entorno no declaradas en el schema:",
        );
        for (const key of unknownKeys) {
          console.error(`  - ${key}`);
        }
        throw new ConfigValidationError(
          "Claves de configuración desconocidas detectadas (strict mode). " +
            "Añádelas al schema o desactiva strict: false.",
          unknownKeys.map((k) => ({ path: k, message: "Clave no declarada" })),
        );
      }
    }

    // Registramos cada variable validada en el ConfigService
    const configService = new DefaultConfigService();
    for (const [key, value] of Object.entries(coerced as Record<string, any>)) {
      configService.setConfig(key, value);
    }

    // Registramos el servicio en el contenedor DI
    container.registerInstance(CONFIG_SERVICE_TOKEN, configService);

    // Aseguramos que INTERNAL_CONFIG_SERVICE_TOKEN resuelva la misma instancia
    // (DefaultConfigService implementa ambas interfaces)
    if (!container.has(INTERNAL_CONFIG_SERVICE_TOKEN)) {
      container.registerFactory(
        INTERNAL_CONFIG_SERVICE_TOKEN,
        (c) => c.resolve(CONFIG_SERVICE_TOKEN),
        ScopeType.Singleton,
      );
    }

    // Inicializamos hot-reload si está activado
    if (options.hotReload && process.env.NODE_ENV !== "production") {
      const watcher = new ConfigWatcher(options.watchDebounce ?? 500);

      // Observamos archivos .env comunes
      watcher.watch(
        [
          ".env",
          ".env.local",
          ".env.development",
          ".env.production",
          "config.*",
        ],
        (_filePath) => {
          logger.info("[FastifyKit ConfigModule] Recargando configuración...");

          // Re-validamos y actualizamos
          const newEnv: Record<string, unknown> = {};
          for (const key of schemaKeys) {
            const envKey = envPrefix ? `${envPrefix}${key}` : key;
            if (process.env[envKey] !== undefined) {
              newEnv[key] = process.env[envKey];
            }
          }

          try {
            const newCoerced = ConfigValidator.coerce(options.schema, newEnv);
            const validated = ConfigValidator.validate(compiler, newCoerced);

            for (const [key, value] of Object.entries(
              validated as Record<string, any>,
            )) {
              configService.setConfig(key, value);
            }

            logger.info(
              "[FastifyKit ConfigModule] Configuración recargada exitosamente.",
            );
          } catch (err) {
            logger.error(
              "[FastifyKit ConfigModule] Error recargando configuración. Se mantiene la anterior.",
              { error: err },
            );
          }
        },
      );
    }
  }
}
