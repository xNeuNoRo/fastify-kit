import type { FastifyKitMetadata } from "./types.js";
import type { StaticAssetsOptions } from "../interfaces/static.interface.js";

/**
 * @description Decorador de clase para servir un directorio completo de archivos estáticos.
 * Al aplicar este decorador, el framework registra automáticamente una ruta optimizada
 * bajo el prefijo del controlador para servir todos los archivos contenidos en el directorio.
 * @param options Configuración de los archivos estáticos (ruta, compresión, seguridad, etc.)
 * @returns Una función que inyecta la configuración en la metadata de la clase.
 * @example
 * \@Controller("/public")
 * \@StaticAssets({ root: path.join(process.cwd(), "public/images"), compress: true })
 * class MediaController {}
 */
export function StaticAssets(options: StaticAssetsOptions) {
  return function (_target: Function, context: ClassDecoratorContext) {
    if (context.kind !== "class") {
      throw new Error(
        "[FastifyKit] @StaticAssets solo puede ser aplicado a clases",
      );
    }

    // Accedemos a la metadata
    const metadata = context.metadata as FastifyKitMetadata;

    // Almacenamos las opciones para que el scanner las procese despues
    metadata.staticAssets = options;
  };
}
