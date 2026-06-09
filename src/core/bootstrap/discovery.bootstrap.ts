import { type Constructor } from "../../http/routing/scanner/index.js";
import {
  discoverControllers,
  discoverHandlers,
  discoverModules,
} from "../discovery.js";
import { container } from "../../container/DIContainer.js";
import type { ModuleOptions } from "../../http/decorators/types.js";
import { FASTIFY_KIT_METADATA_SYMBOL } from "../FastifyKit.js";

/**
 * @description Método privado recursivo para bootstrappear un módulo y sus submódulos, registrando sus controladores y proveedores en el contenedor de inyección de dependencias. Este método se encarga de evitar ciclos en el árbol de módulos utilizando un conjunto de módulos visitados, y fusiona los controladores explícitos definidos en cada módulo con los controladores descubiertos automáticamente si se ha configurado el auto-discover.
 * @param moduleClass La clase del módulo a bootstrappear. Esta clase debe estar decorada con \@Module para que la Factory pueda extraer sus opciones y metadata.
 * @param visited Un conjunto de módulos que ya han sido visitados en el proceso de bootstrap para evitar ciclos en el árbol de módulos. Se inicializa como un conjunto vacío en la llamada inicial.
 * @returns Un objeto que contiene un array con todos los controladores encontrados en el módulo y sus submódulos, listo para ser registrado en Fastify.
 */
export async function bootstrapModule(
  moduleClass: any,
  visited = new Set(),
  globalControllers = new Set<Constructor>(),
  globalProvidersMap = new Map<
    any,
    { token: any; implementation: Constructor }
  >(),
  isRoot = true,
): Promise<{
  allControllers: Constructor[];
  allProviders: { token: any; implementation: Constructor }[];
}> {
  // Evitamos ciclos en el árbol de módulos marcando el módulo actual como visitado.
  // Si ya ha sido visitado, significa que hay un ciclo y
  // simplemente retornamos arrays vacíos para no agregar controladores duplicados ni entrar en un bucle infinito.
  if (visited.has(moduleClass)) return { allControllers: [], allProviders: [] };
  visited.add(moduleClass);

  const metadata = getModuleMetadata(moduleClass);
  const currentProviders = registerModuleProviders(
    metadata.providers,
    moduleClass,
  );

  // Recolectamos los Handlers y los registramos como proveedores
  const discoveredHandlers = await collectModuleHandlers(metadata);
  for (const Handler of discoveredHandlers) {
    const isAlreadyProvider = currentProviders.some((p) => p.token === Handler);
    // Si el Handler ya está registrado como proveedor explícito, no lo registramos de nuevo
    // para evitar duplicados. Esto permite que el dev tenga control total sobre qué clases
    // se registran como proveedores, incluso si también son Handlers descubiertos automáticamente.
    if (!isAlreadyProvider) {
      if (!container.has(Handler)) {
        container.registerClass(Handler, Handler);
      }
      currentProviders.push({ token: Handler, implementation: Handler });
    }
  }

  for (const provider of currentProviders) {
    // Agregamos el proveedor al mapa global para evitar duplicados en submódulos
    if (!globalProvidersMap.has(provider.token)) {
      globalProvidersMap.set(provider.token, provider);
    }
  }
  const [localControllers, allModules] = await Promise.all([
    collectModuleControllers(metadata),
    collectModuleImports(metadata),
  ]);

  // Agregamos los controladores locales al conjunto global para evitar duplicados en submódulos
  for (const controller of localControllers) {
    globalControllers.add(controller);
  }

  // Bootstrappeamos recursivamente los submódulos, pasándoles las referencias globales para que puedan agregar sus controladores y proveedores sin duplicados.
  for (const subModule of allModules) {
    await bootstrapModule(
      subModule,
      visited,
      globalControllers,
      globalProvidersMap,
      false,
    );
  }

  // Si estamos en el módulo raíz, retornamos todos los controladores y proveedores globales encontrados en todo el árbol de módulos.
  if (isRoot) {
    return {
      allControllers: Array.from(globalControllers),
      allProviders: Array.from(globalProvidersMap.values()),
    };
  }

  // Retorno "dummy" para las llamadas recursivas internas, ya que
  // su trabajo real fue mutar `globalControllers` y `globalProvidersMap`.
  return { allControllers: [], allProviders: [] };
}

/**
 * @description Función auxiliar para extraer la metadata de un módulo a partir de su clase. Esta función verifica que la clase proporcionada tenga la metadata esperada (definida por el decorador \@Module) y la devuelve como un objeto de tipo ModuleOptions. Si la clase no tiene la metadata requerida, lanza un error indicando que la clase no es un módulo válido.
 * @param moduleClass La clase del módulo de la cual se desea extraer la metadata. Esta clase debe estar decorada con \@Module para que la Factory pueda extraer sus opciones y metadata.
 * @returns Un objeto de tipo ModuleOptions que contiene la metadata del módulo extraída de la clase proporcionada. Esta metadata incluye las opciones definidas en el decorador \@Module, como controladores, proveedores, módulos importados, y configuración de auto-discover.
 */
export function getModuleMetadata(moduleClass: any): ModuleOptions {
  const metadata = moduleClass[FASTIFY_KIT_METADATA_SYMBOL]
    ?.moduleOptions as ModuleOptions;

  if (!metadata)
    throw new Error(`Clase ${moduleClass.name} no es un @Module válido.`);

  return metadata;
}

/**
 * @description Función auxiliar para registrar los proveedores de un módulo en el contenedor de inyección de dependencias. Esta función procesa la lista de proveedores definida en las opciones del módulo, registrando cada proveedor en el contenedor con su token e implementación correspondientes. La función soporta tanto proveedores definidos como clases normales (ej: BookService) como proveedores definidos con un contrato explícito (ej: { contract: IBookRepository, implementation: BookRepository }). Si un proveedor no cumple con ninguno de estos formatos, la función lanza un error indicando que el proveedor está mal configurado.
 * @param providers El array de proveedores definido en las opciones del módulo. Cada proveedor puede ser una clase normal o un objeto con un contrato explícito y su implementación correspondiente.
 * @param moduleClass La clase del módulo al que pertenecen los proveedores. Se utiliza para proporcionar información contextual en caso de que haya un error en la configuración de los proveedores.
 * @returns Un array de objetos que contienen el token y la implementación de cada proveedor registrado. Este array se utiliza posteriormente para fusionar los proveedores de submódulos y evitar duplicados antes de registrarlos en Fastify.
 */
export function registerModuleProviders(
  providers: any[] | undefined,
  moduleClass: any,
): { token: any; implementation: Constructor }[] {
  const currentProviders: { token: any; implementation: Constructor }[] = [];

  if (!providers) return currentProviders;

  // Registramos los proveedores de este módulo en el contenedor de inyección de dependencias
  // para que puedan ser resueltos e inyectados en los controladores.
  for (const provider of providers) {
    if (typeof provider === "function") {
      // Es una clase normal (ej: BookService)
      container.registerClass(provider, provider);
      currentProviders.push({ token: provider, implementation: provider });
      continue;
    }

    if (provider?.contract && provider.implementation) {
      // Es un contrato explícito (ej: { contract: IBookRepository, implementation: BookRepository })
      container.registerClass(provider.contract, provider.implementation);
      currentProviders.push({
        token: provider.contract,
        implementation: provider.implementation,
      });
      continue;
    }

    throw new Error(
      `Proveedor mal configurado en el módulo ${moduleClass.name}. Usa una clase o { contract: X, implementation: Y }`,
    );
  }

  return currentProviders;
}

/**
 * @description Función auxiliar para recolectar los controladores de un módulo, combinando los controladores definidos explícitamente en las opciones del módulo con los controladores descubiertos automáticamente si se ha configurado el auto-discover. Esta función permite que el usuario tenga la flexibilidad de definir manualmente algunos controladores en el módulo, mientras que la Factory se encarga de descubrir automáticamente otros controladores en el directorio especificado sin que el usuario tenga que listarlos todos manualmente.
 * @param metadata La metadata del módulo extraída de su clase, que incluye las opciones definidas en el decorador \@Module, como controladores explícitos y configuración de auto-discover.
 * @returns Un array de constructores de los controladores que se han recolectado para este módulo, listo para ser registrado en Fastify. Este array incluye tanto los controladores definidos explícitamente en las opciones del módulo como los controladores descubiertos automáticamente si se ha configurado el auto-discover. Si no se han definido controladores explícitos ni se ha configurado el auto-discover, el array estará vacío.
 */
export async function collectModuleControllers(
  metadata: ModuleOptions,
): Promise<Constructor[]> {
  // Obtenemos los controladores definidos explícitamente en este módulo
  // Y tambien descubrimos controladores automáticamente si se ha configurado el auto-discover para este módulo.
  const explicitControllers = metadata.controllers || [];
  const discoveredControllers = metadata.autoDiscoverControllers
    ? await discoverControllers(metadata.autoDiscoverControllers)
    : [];

  // Fusionamos los controladores explícitos y los descubiertos
  return [...explicitControllers, ...discoveredControllers];
}

/**
 * @description Función auxiliar para recolectar los manejadores CQRS (Handlers) descubiertos automáticamente
 * si se ha configurado el auto-discover en el módulo.
 */
export async function collectModuleHandlers(
  metadata: ModuleOptions,
): Promise<Constructor[]> {
  return metadata.autoDiscoverCQRSHandlers
    ? await discoverHandlers(metadata.autoDiscoverCQRSHandlers)
    : [];
}

/**
 * @description Función auxiliar para recolectar los módulos importados por un módulo, combinando los módulos importados explícitamente en las opciones del módulo con los módulos descubiertos automáticamente si se ha configurado el auto-discover. Esta función permite que el usuario tenga la flexibilidad de definir manualmente algunos módulos importados en el módulo, mientras que la Factory se encarga de descubrir automáticamente otros módulos en el directorio especificado sin que el usuario tenga que listarlos todos manualmente.
 * @param metadata La metadata del módulo extraída de su clase, que incluye las opciones definidas en el decorador \@Module, como módulos importados explícitos y configuración de auto-discover.
 * @returns Un array de las clases de los módulos importados por este módulo, listo para ser bootstrappeado recursivamente. Este array incluye tanto los módulos importados explícitamente en las opciones del módulo como los módulos descubiertos automáticamente si se ha configurado el auto-discover. Si no se han definido módulos importados explícitos ni se ha configurado el auto-discover, el array estará vacío.
 */
export async function collectModuleImports(
  metadata: ModuleOptions,
): Promise<any[]> {
  // De manera similar, si el módulo tiene módulos importados (submódulos), los bootstrappeamos recursivamente para obtener sus controladores y agregarlos a la lista de controladores a registrar.
  const manualImports = metadata.imports || [];
  const discoveredModules = metadata.autoDiscoverModules
    ? await discoverModules(metadata.autoDiscoverModules)
    : [];

  // Fusionamos los módulos importados explícitamente y los descubiertos
  return [...manualImports, ...discoveredModules];
}
