import fs from "node:fs/promises";
import path from "node:path";
import "@fastify/websocket";
import { FastifyInstance, FastifyRequest } from "fastify";
import type { WebSocket } from "ws";
import { extractArguments, type Constructor } from "./scanner.js";
import { pathToFileURL } from "node:url";
import type { FastifyKitMetadata } from "../decorators/types.js";
import { Dirent } from "node:fs";
import { getLogger } from "../../logger/logger.factory.js";
import { container } from "../../container/DIContainer.js";
import { JsonWsAdapter } from "../../websockets/adapters/JsonWsAdapter.js";

const decoratorMetadataSymbol: symbol =
  (Symbol as any).metadata ?? Symbol.for("Symbol.metadata");

export function registerGateways(
  app: FastifyInstance,
  gateways: Constructor[],
) {
  // Handler para limpiar conexiones muertas cada 30 segundos
  const pingInterval = setInterval(() => {
    // Si el servidor de WebSockets está activo
    if (app.websocketServer) {
      // Iteramos sobre todos los clientes conectados al servidor de WebSockets
      for (const client of app.websocketServer.clients) {
        const wsClient = client as any;
        // Si el cliente no respondió al último ping, lo matamos.
        if (wsClient.isAlive === false) {
          client.terminate();
          continue;
        }
        // Marcamos el cliente como no vivo y le enviamos un ping. Si responde, lo marcaremos como vivo en el handler de pong.
        wsClient.isAlive = false;
        client.ping();
      }
    }
  }, 30000);

  // Desvinculamos el intervalo para que no impida que el proceso se cierre naturalmente si no hay otras tareas pendientes
  pingInterval.unref();

  // Apagamos el intervalo de limpieza de conexiones muertas cuando el servidor se cierra para evitar memory leaks
  app.addHook("onClose", (instance, done) => {
    clearInterval(pingInterval);
    if (instance.websocketServer) {
      for (const client of instance.websocketServer.clients) {
        client.terminate();
      }
    }
    done();
  });

  for (const GatewayClass of gateways) {
    const metadata = (GatewayClass as any)[
      decoratorMetadataSymbol
    ] as FastifyKitMetadata;

    // Si no tiene decorador de @WebSocketGateway, lo ignoramos
    if (!metadata?.wsGateway) continue;

    // Resolvemos la clase Gateway del contenedor de dependencias
    const instance = container.resolve(GatewayClass);
    // Y extraemos su metadata para registrar sus eventos de WebSockets
    const options = metadata.wsGateway;
    const events = metadata.wsEvents || [];

    // Instanciamos el adaptador de WebSockets definido en la configuración del decorador o usamos el adaptador por defecto (JsonWsAdapter)
    const AdapterClass = options.adapter || JsonWsAdapter;
    const adapter = new AdapterClass();

    // Mapas para almacenar los métodos de cada tipo de evento (connect, disconnect, message) y sus patrones asociados
    const eventRouter = new Map<string, string>();

    // Variables para almacenar los nombres de los métodos manejadores de eventos de conexión, desconexión y mensajes sin patrón (firehose)
    let onConnectMethod: string | null = null;
    let onDisconnectMethod: string | null = null;
    let firehoseMethod: string | null = null;

    // Iteramos sobre la metadata de eventos para definir los métodos manejadores de cada tipo de evento y sus patrones asociados
    for (const event of events) {
      if (event.type === "connect") onConnectMethod = event.handlerName;
      if (event.type === "disconnect") onDisconnectMethod = event.handlerName;
      if (event.type === "message" && event.pattern)
        eventRouter.set(event.pattern, event.handlerName);
      if (event.type === "message" && !event.pattern)
        firehoseMethod = event.handlerName;
    }

    // Registramos la ruta del WebSocket en Fastify usando la configuración del decorador y el handler para gestionar las conexiones entrantes, mensajes y desconexiones
    app.get(
      options.path,
      { websocket: true },
      (connection: WebSocket, request: FastifyRequest) => {
        connection.on("message", (rawMessage: Buffer) => {
          (async () => {
            try {
              const packet = adapter.decode(rawMessage);
              let handlerName: string | null = null;

              // Primero intentamos encontrar un handler específico para el patrón del mensaje entrante.
              // Si no lo encontramos, verificamos si hay un handler de firehose (sin patrón) definido para manejar mensajes sin patrón específico.
              if (packet.pattern && eventRouter.has(packet.pattern)) {
                handlerName = eventRouter.get(packet.pattern)!;
              } else if (firehoseMethod) {
                handlerName = firehoseMethod;
              }

              // Si encontramos un handler para el mensaje entrante
              if (handlerName) {
                // Extraemos los argumentos necesarios para ejecutar el handler
                const paramsMeta = metadata.parameters?.[handlerName] || [];
                const args = await extractArguments(
                  request,
                  null as any,
                  paramsMeta,
                  { socket: connection, payload: packet.payload },
                );

                // Ejecutamos el handler con los argumentos extraídos y obtenemos el resultado
                const result = await instance[handlerName](...args);

                // Si el handler retorna algo distinto de undefined
                if (result !== undefined) {
                  // Si hay un patrón definido para el mensaje entrante
                  if (packet.pattern) {
                    // Codificamos la respuesta usando el adaptador definido para mantener la consistencia en el formato de los mensajes enviados al cliente
                    const encodedResponse = adapter.encode(
                      packet.pattern,
                      result,
                    );
                    // Enviamos la respuesta codificada al cliente
                    connection.send(encodedResponse);
                  } else {
                    // Si no hay un patrón definido (handler de firehose), enviamos la respuesta tal cual, codificándola a string si es un objeto, para que el cliente la reciba sin formato específico
                    const rawResponse =
                      typeof result === "object"
                        ? JSON.stringify(result)
                        : String(result);
                    connection.send(rawResponse);
                  }
                }
              } else {
                connection.send(
                  "ERROR:HANDLER_NOT_FOUND_FOR_PATTERN:" + packet.pattern,
                );
              }
            } catch (err: any) {
              connection.send("ERROR:INVALID_MESSAGE_FORMAT");
              console.log(err);
              getLogger().error(
                `[FastifyKit WS] Error procesando mensaje en ${GatewayClass.name}:`,
                err,
              );
            }
          })();
        });

        // Evento de desconexión del cliente
        connection.on("close", () => {
          // Si existe un metodo manejador para el evento de desconexión
          if (onDisconnectMethod) {
            (async () => {
              try {
                // Extramos los argumentos necesario y lo ejecutamos
                const paramsMeta =
                  metadata.parameters?.[onDisconnectMethod] || [];
                const args = await extractArguments(
                  request,
                  null as any,
                  paramsMeta,
                  { socket: connection, payload: null },
                );
                await instance[onDisconnectMethod](...args);
              } catch (err: any) {
                // En caso de error, lo logueamos pero no hacemos nada más
                getLogger().error(
                  `[FastifyKit WS] Error en @OnDisconnect de ${GatewayClass.name}:`,
                  err,
                );
              }
            })();
          }
        });

        // Evento de ping recibido del cliente para mantener viva la conexión.
        connection.on("pong", () => {
          (connection as any).isAlive = true;
        });

        // Marcamos la conexión como viva inicialmente
        (connection as any).isAlive = true;

        // Si hay un metodo manejador para el evento de conexión
        if (onConnectMethod) {
          (async () => {
            try {
              // Extraemos los argumentos necesario y lo ejecutamos
              const paramsMeta = metadata.parameters?.[onConnectMethod] || [];
              const args = await extractArguments(
                request,
                null as any,
                paramsMeta,
                { socket: connection, payload: null },
              );
              await instance[onConnectMethod](...args);
            } catch (err: any) {
              getLogger().error(
                `[FastifyKit WS] Error en @OnConnect de ${GatewayClass.name}:`,
                err,
              );
              connection.close(1011, "Internal Server Error");
            }
          })();
        }
      },
    );
  }
}

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
      // Si la metadata cumple con los criterios definidos, agregamos la clase al array de descubiertas
      if (metadata && criteria(metadata)) {
        discovered.push(exportedItem as Constructor);
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
}: {
  callback: (dir: string) => Promise<void>;
  entries: Dirent<string>[];
  currentDir: string;
  suffixes: string[];
  criteria: (metadata: FastifyKitMetadata) => boolean;
  discovered: Constructor[];
}) {
  // Recorremos todas las entradas del directorio actual
  const promises = entries.map(async (entry) => {
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
        iterateModuleExports(module, criteria, discovered);
      } catch (err) {
        getLogger().warn(
          `[FastifyKit Discovery] Error al importar ${fullPath}, archivo ignorado.`,
          err instanceof Error
            ? { message: err.message, stack: err.stack }
            : { error: String(err) },
        );
      }
    }
  });
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
