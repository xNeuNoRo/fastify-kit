import type { TSchema } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import {
  CONFIG_SERVICE_TOKEN,
  type ConfigService,
} from "../../config/ConfigService.js";
import { INTERNAL_CONFIG_SERVICE_TOKEN } from "../../config/InternalConfigService.js";
import { DefaultConfigService } from "../../config/DefaultConfigService.js";
import { ScopeType, container } from "../../container/DIContainer.js";
import { Value } from "@sinclair/typebox/value";

/**
 * @description Método privado para validar las variables de entorno utilizando el esquema proporcionado por el usuario en las opciones de FastifyKit. Este método extrae solo las variables de entorno definidas en el esquema, coerciona sus valores según los tipos definidos en el esquema (ej: números, booleanos), y luego valida el entorno coercionado contra el esquema utilizando TypeBox. Si la validación falla, se extraen los errores y se muestran de manera clara en la consola, indicando qué variable no pasó la validación, cuál era el tipo esperado y cuál fue el mensaje de error. Finalmente, se aborta la inicialización del servidor para evitar que se ejecute con una configuración de entorno incorrecta. Si la validación es exitosa, las variables de entorno coercionadas y validadas se registran individualmente en el ConfigService para que puedan ser accedidas de manera tipada en cualquier parte del código.
 * @param envSchema El esquema de validación de las variables de entorno proporcionado por el usuario en las opciones de FastifyKit. Este esquema debe ser un TSchema de TypeBox que defina las variables de entorno esperadas, sus tipos y cualquier otra validación necesaria. El método utiliza este esquema para validar y coercionar las variables de entorno antes de registrar su valor en el ConfigService.
 */
export function validateAndLoadEnvironment(envSchema: TSchema): void {
  // Extraemos solo las variables de entorno que están definidas en el esquema
  const schemaKeys = Object.keys((envSchema as any).properties || {});
  // Creamos un nuevo objeto con solo las variables de entorno relevantes para la validación y coerción
  const extractedEnv: Record<string, unknown> = {};

  // Iteramos sobre las claves definidas en el esquema
  for (const key of schemaKeys) {
    // Si existe la variable de entorno, la agregamos al objeto de entorno extraído
    if (process.env[key] !== undefined) {
      extractedEnv[key] = process.env[key];
    }
  }

  // Coercionamos los valores de entorno extraídos según el esquema para asegurarnos de
  // que tengan los tipos correctos (ej: números, booleanos) antes de validarlos.
  const coercedEnv = Value.Convert(envSchema, extractedEnv);

  // Compilamos el esquema
  const compiler = TypeCompiler.Compile(envSchema);
  // Validamos el entorno coercionado contra el esquema.
  const isValid = compiler.Check(coercedEnv);

  // Si no es valido
  if (!isValid) {
    // Extraemos los errores y los mostramos de manera clara en la consola
    const errors = [...compiler.Errors(coercedEnv)];
    console.error(
      "[FastifyKit Boot Error] Ha fallado la validación de las variables de entorno:",
    );
    for (const err of errors) {
      console.error(
        `   - Variable: ${err.path.replace("/", "")} | Esperado: ${
          err.schema.type
        } | Mensaje: ${err.message}`,
      );
    }
    // Evitamos inicializar el servidor hasta que se configuren debidamente
    console.error("Abortando la inicialización del servidor por seguridad.");
    process.exit(1);
  }

  // Aseguramos que ConfigService esté registrado en el contenedor DI
  // (puede haber sido limpiado por tests que llaman a container.clearAll())
  if (!container.has(CONFIG_SERVICE_TOKEN)) {
    container.registerClass(CONFIG_SERVICE_TOKEN, DefaultConfigService);
  }

  // Aseguramos que INTERNAL_CONFIG_SERVICE_TOKEN resuelva la misma instancia
  if (!container.has(INTERNAL_CONFIG_SERVICE_TOKEN)) {
    container.registerFactory(
      INTERNAL_CONFIG_SERVICE_TOKEN,
      (c) => c.resolve(CONFIG_SERVICE_TOKEN),
      ScopeType.Singleton,
    );
  }

  // Registramos individualmente cada variable de entorno validada y coercionada en el
  // ConfigService para que puedan ser accedidas de manera tipada en cualquier parte
  // Con el decorador @InjectConfig("VARIABLE") o directamente con ConfigService.getConfig("VARIABLE")
  const configService = container.resolve<ConfigService>(CONFIG_SERVICE_TOKEN);
  for (const [key, value] of Object.entries(
    coercedEnv as Record<string, any>,
  )) {
    configService.setConfig(key, value);
  }
}
