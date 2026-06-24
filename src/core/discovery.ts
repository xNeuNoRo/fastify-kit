import fs from "node:fs/promises";
import path from "node:path";
import type { Constructor } from "../http/routing/scanner/index.js";
import { pathToFileURL } from "node:url";
import type { FastifyKitMetadata } from "../http/decorators/types.js";
import { Dirent } from "node:fs";
import { getLogger } from "../logger/logger.factory.js";
import { container } from "../container/DIContainer.js";
import {
  QUEUE_REGISTRY_TOKEN,
  type QueueRegistryService,
} from "../queues/QueueRegistryService.js";
import pLimit from "p-limit";

const decoratorMetadataSymbol: symbol =
  (Symbol as any).metadata ?? Symbol.for("Symbol.metadata");

export interface AutoDiscoverOptions {
  /**
   * Directorio base donde buscar (ej: path.join(process.cwd(), 'src', 'modules'))
   */
  baseDir: string;
  /**
   * Patrón de sufijo de los archivos a buscar.
   * Puede ser un string o un array de strings.
   * Ej: ".controller.ts" o [".controller.ts", ".controller.js"]
   */
  suffix?: string | string[];
  /**
   * Número máximo de operaciones de lectura/importación simultáneas.
   * Limitar la concurrencia previene el agotamiento de file descriptors
   * (EMFILE) en proyectos con miles de archivos.
   * @default 50
   */
  concurrency?: number;
}

/**
 * @description Función genérica para recorrer las entradas de un directorio y sus subdirectorios, buscando archivos que coincidan con los sufijos definidos. Para cada archivo encontrado, importa dinámicamente el módulo y verifica si exporta clases que cumplan con los criterios definidos en la función. Si es así, agrega esas clases al array de descubiertas.
 * @param module El módulo importado dinámicamente desde un archivo encontrado. Se espera que este módulo exporte una o varias clases decoradas con metadata de FastifyKit.
 * @param criteria Función que recibe la metadata de cada clase exportada y devuelve un booleano indicando si esa clase cumple con los criterios para ser incluida en el resultado. Esto permite filtrar las clases descubiertas según la metadata que tengan (por ejemplo, solo incluir clases que tengan un prefix definido para controladores).
 * @param discovered El array donde se almacenarán las clases descubiertas que cumplen con los criterios definidos. Este array se va llenando a medida que se recorren los módulos importados y se encuentran clases que cumplen con los criterios.
 */
function iterateModuleExports(
  module: any,
  criteria: (metadata: FastifyKitMetadata) => boolean,
  discovered: Constructor[],
  fileUrl: string,
) {
  // Iteramos sobre lo que exporta el archivo (por si exporta varias clases)
  for (const key of Object.keys(module)) {
    // Verificamos si lo exportado es una función (posible clase)
    // y si tiene metadata (decoradores)
    const exportedItem = module[key];
    if (typeof exportedItem === "function" && decoratorMetadataSymbol) {
      const metadata = (exportedItem as Record<PropertyKey, unknown>)[
        decoratorMetadataSymbol
      ] as FastifyKitMetadata | undefined;
      if (metadata) {
        // Si la clase tiene metadata de queue, registramos el archivo
        // en el QueueRegistryService para que luego sepa dónde encontrarlo en los workers aislados
        if (metadata.queue) {
          const queueRegistry = container.resolve<QueueRegistryService>(QUEUE_REGISTRY_TOKEN);
          queueRegistry.addProcessorFile(fileUrl);
        }

        // Si la metadata cumple con los criterios definidos, agregamos la clase al array de descubiertas
        if (criteria(metadata)) {
          discovered.push(exportedItem as Constructor);
        }
      }
    }
  }
}

/**
 * @description Función genérica para recorrer las entradas de un directorio y sus subdirectorios, buscando archivos que coincidan con los sufijos definidos. Para cada archivo encontrado, importa dinámicamente el módulo y verifica si exporta clases que cumplan con los criterios definidos en la función. Si es así, agrega esas clases al array de descubiertas.
 * @param param0 Objeto con los parámetros necesarios para recorrer las entradas del directorio, incluyendo la función de callback para escanear subdirectorios, el array de entradas del directorio actual, el directorio actual, los sufijos a buscar, la función de criterios para filtrar las clases descubiertas, y el array donde se almacenarán las clases descubiertas.
 */
async function walkEntries({
  callback,
  entries,
  currentDir,
  suffixes,
  criteria,
  discovered,
  concurrency,
}: {
  callback: (dir: string) => Promise<void>;
  entries: Dirent<string>[];
  currentDir: string;
  suffixes: string[];
  criteria: (metadata: FastifyKitMetadata) => boolean;
  discovered: Constructor[];
  concurrency: number;
}) {
  // Limitamos la concurrencia de operaciones de archivo (readdir + import dinámico)
  // para prevenir EMFILE en proyectos con miles de archivos
  const limit = pLimit(concurrency);

  // Recorremos todas las entradas del directorio actual
  const promises = entries.map((entry) =>
    limit(async () => {
      const fullPath = path.join(currentDir, entry.name);

      // Si es un directorio, lo escaneamos recursivamente. Si es un archivo, verificamos si coincide con los sufijos buscados.
      if (entry.isDirectory()) {
        await callback(fullPath); // Buscamos recursivamente por cada subdirectorio
      } else if (entry.isFile() && suffixes.some((s) => entry.name.endsWith(s))) {
        // Importante: Bun y Node ESM requieren URLs (file://...) para imports dinámicos absolutos
        const fileUrl = pathToFileURL(fullPath).href;

        try {
          // Importamos el archivo dinámicamente
          const module = await import(fileUrl);

          // Iteramos sobre lo que exporta el archivo (por si exporta varias clases) y lo guardamos en el array
          // de discovered si cumple con los criterios definidos
          iterateModuleExports(module, criteria, discovered, fileUrl);
        } catch (err) {
          getLogger().warn(
            `[FastifyKit Discovery] Error al importar ${fullPath}, archivo ignorado.`,
            err instanceof Error
              ? { message: err.message, stack: err.stack }
              : { error: String(err) },
          );
        }
      }
    }),
  );
  // Esperamos a que se completen todas las operaciones de lectura de directorios e importación de archivos antes de continuar
  await Promise.all(promises);
}

/**
 * @description Función genérica para descubrir clases decoradas en un directorio dado. Escanea recursivamente el directorio base especificado en busca de archivos que terminen con los sufijos definidos. Importa dinámicamente cada archivo encontrado y verifica si exporta una clase decorada que cumpla con los criterios definidos en la función. Devuelve un array con las clases descubiertas que cumplen con los criterios.
 * @param options Objeto de opciones para la función de descubrimiento automático. Incluye el directorio base donde buscar y el patrón de sufijo de los archivos a buscar.
 * @param defaultSuffixes Sufijos por defecto a usar si no se proporcionan en las opciones. Esto permite reutilizar la lógica de descubrimiento para diferentes tipos de clases (controladores, servicios, etc.) con diferentes sufijos.
 * @param criteria Función que recibe la metadata de cada clase exportada y devuelve un booleano indicando si esa clase cumple con los criterios para ser incluida en el resultado. Esto permite filtrar las clases descubiertas según la metadata que tengan (por ejemplo, solo incluir clases que tengan un prefix definido para controladores).
 * @example
 * // Descubrir controladores
 * const controllers = await discoverClasses(
 *   {
 *     baseDir: path.join(process.cwd(), "src", "modules"),
 *     suffix: ".controller.ts",
 *   },
 *   [".controller.ts", ".controller.js"],
 *   (metadata) => metadata.prefix !== undefined, // Solo incluimos clases que tengan un prefix definido en su metadata
 * );
 * @returns Un array de constructores de las clases descubiertas que cumplen con los criterios definidos.
 */
async function discoverClasses(
  options: AutoDiscoverOptions,
  defaultSuffixes: string[],
  criteria: (metadata: FastifyKitMetadata) => boolean,
): Promise<Constructor[]> {
  // Array para almacenar las clases descubiertas que cumplen con los criterios
  const discovered: Constructor[] = [];
  // Determinamos los sufijos a usar para la búsqueda, usando los proporcionados en las opciones o los sufijos por defecto
  let suffixArray: string[];
  if (Array.isArray(options.suffix)) {
    suffixArray = options.suffix;
  } else if (options.suffix) {
    suffixArray = [options.suffix];
  } else {
    suffixArray = [];
  }
  const suffixes = suffixArray.length > 0 ? suffixArray : defaultSuffixes;
  const concurrency = options.concurrency ?? 50;

  // Función recursiva para escanear directorios
  async function scanDir(currentDir: string) {
    try {
      // withFileTypes: true nos da objetos Dirent que indican si cada entrada es un archivo o directorio
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      await walkEntries({
        callback: scanDir,
        entries,
        currentDir,
        suffixes,
        criteria,
        discovered,
        concurrency,
      });
    } catch (err) {
      console.warn(`[FastifyKit Discovery] Error en ${currentDir}:`, err);
    }
  }

  // Iniciamos el escaneo desde el directorio base
  await scanDir(options.baseDir);

  // Devolvemos todas las clases descubiertas que cumplen con los criterios
  return discovered;
}

/**
 * @description Descubre controladores (clases con metadata.prefix).
 * @param options Opciones para el descubrimiento automático, incluyendo el directorio base y los sufijos de archivo a buscar.
 */
export const discoverControllers = (options: AutoDiscoverOptions) =>
  discoverClasses(
    options,
    [".controller.ts", ".controller.js"], // Sufijos por defecto para controladores
    (meta) => meta.prefix !== undefined,
  );

/**
 * @description Descubre módulos (clases con metadata.moduleOptions).
 * @param options Opciones para el descubrimiento automático, incluyendo el directorio base y los sufijos de archivo a buscar.
 */
export const discoverModules = (options: AutoDiscoverOptions) =>
  discoverClasses(
    options,
    [".module.ts", ".module.js"], // Sufijos por defecto para módulos
    (meta) => meta.moduleOptions !== undefined,
  );

/**
 * @description Descubre manejadores de CQRS (clases exportadas en archivos con sufijo .handler.ts o .handler.js).
 * @param options Opciones para el descubrimiento automático, incluyendo el directorio base y los sufijos.
 */
export const discoverHandlers = (options: AutoDiscoverOptions) =>
  discoverClasses(
    options,
    [".handler.ts", ".handler.js"], // Sufijos por defecto para handlers CQRS
    (meta) => !!meta.cqrsHandler,
  );
