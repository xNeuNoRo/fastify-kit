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
import { WsEventHandlerMetadata } from "../../websockets/decorators/types.js";

const decoratorMetadataSymbol: symbol =
  (Symbol as any).metadata ?? Symbol.for("Symbol.metadata");

/**
 * @description Función para configurar el mecanismo de heartbeat (ping/pong) para conexiones WebSocket, y para manejar el cierre de conexiones muertas. Esta función se encarga de enviar pings periódicos a los clientes conectados para verificar que siguen vivos, y de cerrar las conexiones que no respondan a los pings. También se asegura de limpiar los intervalos y cerrar las conexiones adecuadamente cuando el servidor se cierra para evitar memory leaks.
 * @param app Instancia de Fastify donde se configurará el mecanismo de heartbeat para las conexiones WebSocket. Se espera que esta instancia tenga un servidor de WebSockets configurado (por ejemplo, usando el decorador @WebSocketGateway) para que el mecanismo de heartbeat pueda interactuar con las conexiones WebSocket activas.
 */
function setupHeartbeatAndTeardown(app: FastifyInstance) {
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
}

/**
 * @description Función para ejecutar los métodos de ciclo de vida de conexión y desconexión de WebSockets (\@OnConnect y \@OnDisconnect). Esta función se encarga de extraer los argumentos necesarios para ejecutar el método correspondiente, manejar cualquier error que pueda ocurrir durante la ejecución del método, y en caso de error en el método de conexión, cerrar la conexión WebSocket con un código de error adecuado.
 * @param methodName Nombre del método de ciclo de vida a ejecutar, que puede ser el método decorado con \@OnConnect o \@OnDisconnect según corresponda.
 * @param GatewayClass Clase del Gateway a la que pertenece el método de ciclo de vida que se va a ejecutar. Se usa principalmente para propósitos de logging en caso de error.
 * @param instance Instancia del Gateway a la que pertenece el método de ciclo de vida que se va a ejecutar. Se necesita para poder llamar al método correspondiente en esa instancia.
 * @param metadata Metadata de FastifyKit asociada a la clase del Gateway, que se usa para extraer la información de los parámetros necesarios para ejecutar el método de ciclo de vida.
 * @param request Objeto de solicitud de Fastify que se pasa al método de ciclo de vida para que pueda extraer cualquier información necesaria de la solicitud entrante.
 * @param connection Conexión WebSocket con el cliente, que se pasa al método de ciclo de vida para que pueda interactuar con la conexión si es necesario (por ejemplo, para enviar mensajes al cliente o cerrar la conexión en caso de error).
 * @param isConnectEvent Booleano que indica si el método de ciclo de vida a ejecutar es un método de conexión (\@OnConnect) o de desconexión (\@OnDisconnect), que se usa principalmente para propósitos de logging en caso de error para indicar en qué tipo de evento ocurrió el error.
 */
async function executeLifecycleMethod(
  methodName: string,
  GatewayClass: Constructor,
  instance: any,
  metadata: FastifyKitMetadata,
  request: FastifyRequest,
  connection: WebSocket,
  isConnectEvent: boolean,
) {
  try {
    // Extramos los argumentos necesario y lo ejecutamos
    const paramsMeta = metadata.parameters?.[methodName] || [];
    const args = await extractArguments(request, null as any, paramsMeta, {
      socket: connection,
      payload: null,
    });
    await instance[methodName](...args);
  } catch (err: any) {
    const eventName = isConnectEvent ? "@OnConnect" : "@OnDisconnect";
    // En caso de error, lo logueamos pero no hacemos nada más
    getLogger().error(
      `[FastifyKit WS] Error en ${eventName} de ${GatewayClass.name}:`,
      err,
    );
    if (isConnectEvent) {
      connection.close(1011, "Internal Server Error");
    }
  }
}

/**
 * @description Función para resolver el nombre del handler correspondiente al patrón del mensaje entrante. Si el mensaje tiene un patrón definido y existe un handler registrado para ese patrón, devuelve el nombre de ese handler. Si el mensaje no tiene un patrón definido o no existe un handler registrado para ese patrón, devuelve el nombre del método manejador de mensajes sin patrón (firehose) si está definido, o null si no hay ningún handler disponible para manejar el mensaje.
 * @param pattern Patrón del mensaje entrante, usado para buscar el handler registrado para ese patrón específico. Si el patrón es undefined, se asume que el mensaje entrante no tiene un patrón definido y se intentará usar el handler de firehose si está disponible.
 * @param eventRouter Mapa que asocia patrones de mensajes con los nombres de los métodos manejadores registrados para esos patrones. Se usa para resolver el handler correspondiente al patrón del mensaje entrante.
 * @param firehoseMethod Nombre del método manejador de mensajes sin patrón (firehose), que se usará como fallback si el mensaje entrante no tiene un patrón definido o no existe un handler registrado para ese patrón específico. Si firehoseMethod es null, significa que no hay ningún handler disponible para manejar mensajes sin patrón, y la función devolverá null en ese caso. Si firehoseMethod tiene un valor, se devolverá ese valor como el handler a usar para manejar el mensaje entrante sin patrón.
 * @returns El nombre del handler correspondiente al patrón del mensaje entrante, o el nombre del handler de firehose si el mensaje no tiene un patrón definido o no existe un handler registrado para ese patrón, o null si no hay ningún handler disponible para manejar el mensaje entrante.
 */
function resolveHandlerName(
  pattern: string | undefined,
  eventRouter: Map<string, string>,
  firehoseMethod: string | null,
): string | null {
  // Si el mensaje entrante tiene un patrón definido y existe un handler registrado para ese patrón, devolvemos el nombre de ese handler. Si no, devolvemos el handler de firehose (si está definido) o null si no hay ningún handler disponible para manejar el mensaje.
  if (pattern && eventRouter.has(pattern)) {
    return eventRouter.get(pattern)!;
  }
  // Si el mensaje no tiene un patrón definido o no existe un handler registrado para ese patrón, devolvemos el handler de firehose si está definido, o null si no hay ningún handler disponible para manejar el mensaje.
  return firehoseMethod;
}

/**
 * @description Función para enviar la respuesta del controlador al cliente WebSocket. Si el controlador devuelve undefined, no se envía nada. Si el controlador devuelve un resultado y el mensaje entrante tenía un patrón definido, se empaqueta la respuesta usando el adaptador y se envía al cliente. Si el mensaje entrante no tenía un patrón definido, se intenta convertir la respuesta a string o JSON según su tipo, y se envía como texto plano al cliente.
 * @param connection Conexión WebSocket con el cliente, usada para enviar la respuesta de vuelta al cliente.
 * @param adapter Instancia del adaptador de WebSockets usado para codificar la respuesta si el mensaje entrante tenía un patrón definido.
 * @param pattern Patrón del mensaje entrante, usado para decidir si se debe usar el adaptador para codificar la respuesta o enviarla como texto plano. Si el patrón es undefined, se asume que el mensaje entrante no tenía un patrón definido y se envía la respuesta como texto plano.
 * @param result Resultado devuelto por el controlador, que se enviará al cliente WebSocket. Puede ser de cualquier tipo, y la función intentará convertirlo a string o JSON según su tipo antes de enviarlo al cliente.
 * @returns Nada. La función se encarga de enviar la respuesta al cliente WebSocket, pero no devuelve ningún valor.
 */
function sendMessageResponse(
  connection: WebSocket,
  adapter: any,
  pattern: string | undefined,
  result: unknown,
) {
  if (result === undefined) return;

  // Si el mensaje entrante tenía un patrón definido,
  // usamos el adaptador para codificar la respuesta y enviarla al cliente.
  if (pattern) {
    const encodedResponse = adapter.encode(pattern, result);
    connection.send(encodedResponse);
    return;
  }

  let rawResponse: string;

  // Si no, intentamos convertir la respuesta a string o JSON según su tipo, y la enviamos como texto plano al cliente.
  if (typeof result === "string") {
    rawResponse = result;
  } else if (
    typeof result === "number" ||
    typeof result === "boolean" ||
    typeof result === "bigint" ||
    typeof result === "symbol"
  ) {
    rawResponse = String(result);
  } else if (typeof result === "function") {
    rawResponse = result.toString();
  } else {
    try {
      rawResponse = JSON.stringify(result);
    } catch {
      rawResponse = JSON.stringify({ error: "UNSERIALIZABLE_RESPONSE" });
    }
  }

  // Enviamos la respuesta cruda al cliente WebSocket
  connection.send(rawResponse);
}

/**
 * @description Función para procesar un mensaje entrante de un cliente WebSocket. Esta función se encarga de decodificar el mensaje usando el adaptador definido, resolver el handler correspondiente al patrón del mensaje entrante, extraer los argumentos necesarios para ejecutar el handler, ejecutar el handler y enviar la respuesta de vuelta al cliente WebSocket. Si ocurre algún error durante este proceso (por ejemplo, si el mensaje no es un JSON válido, si no se encuentra un handler para el patrón del mensaje, o si el handler lanza un error), la función maneja esos errores de manera adecuada, enviando mensajes de error al cliente WebSocket o logueando los errores según corresponda.
 * @param param0 Objeto con los parámetros necesarios para procesar el mensaje entrante, incluyendo el mensaje crudo recibido del cliente WebSocket, la clase del Gateway a la que pertenece el handler que se va a ejecutar, la instancia de ese Gateway, la metadata de FastifyKit asociada a esa clase de Gateway, el objeto de solicitud de Fastify asociado a la conexión WebSocket, la conexión WebSocket con el cliente, el adaptador de WebSockets definido para ese Gateway, el mapa de eventos que asocia patrones de mensajes con nombres de métodos manejadores, y el nombre del método manejador de mensajes sin patrón (firehose) si está definido.
 * @returns Nada. La función se encarga de procesar el mensaje entrante y enviar la respuesta al cliente WebSocket, pero no devuelve ningún valor.
 */
async function processIncomingMessage({
  rawMessage,
  GatewayClass,
  instance,
  metadata,
  request,
  connection,
  adapter,
  eventRouter,
  firehoseMethod,
}: {
  rawMessage: string | Buffer;
  GatewayClass: Constructor;
  instance: any;
  metadata: FastifyKitMetadata;
  request: FastifyRequest;
  connection: WebSocket;
  adapter: any;
  eventRouter: Map<string, string>;
  firehoseMethod: string | null;
}) {
  try {
    const packet = adapter.decode(rawMessage);
    // Resolvemos el handler correspondiente al patrón del mensaje entrante.
    const handlerName = resolveHandlerName(
      packet.pattern,
      eventRouter,
      firehoseMethod,
    );

    // Si no encontramos un handler para el patrón del mensaje,
    // en lugar de ignorarlo en silencio, le avisamos al cliente que no se encontró un handler para ese patrón específico.
    if (!handlerName) {
      connection.send("ERROR:HANDLER_NOT_FOUND_FOR_PATTERN:" + packet.pattern);
      return;
    }

    // Extraemos los argumentos necesarios para ejecutar el handler y lo ejecutamos
    const paramsMeta = metadata.parameters?.[handlerName] || [];
    const args = await extractArguments(request, null as any, paramsMeta, {
      socket: connection,
      payload: packet.payload,
    });
    const result = await instance[handlerName](...args);

    // Enviamos la respuesta del handler de vuelta al cliente WebSocket
    sendMessageResponse(connection, adapter, packet.pattern, result);
  } catch (err: any) {
    // En caso de error, le avisamos al cliente que hubo un error procesando el mensaje, y lo logueamos para que el desarrollador pueda investigarlo.
    connection.send("ERROR:INVALID_MESSAGE_FORMAT");
    getLogger().error(
      `[FastifyKit WS] Error procesando mensaje en ${GatewayClass.name}:`,
      err,
    );
  }
}

/**
 * @description Función para mapear la metadata de eventos de un Gateway y resolver los nombres de los métodos manejadores de eventos de conexión, desconexión y mensajes sin patrón (firehose), así como construir el mapa de eventos que asocia patrones de mensajes con nombres de métodos manejadores. Esta función se encarga de iterar sobre la metadata de eventos definida en la clase del Gateway, identificar qué métodos están decorados con \@OnConnect, \@OnDisconnect o \@SubscribeMessage, y extraer la información necesaria para registrar esos eventos correctamente en el servidor de WebSockets.
 * @param events Arreglo de metadata de eventos extraída de la clase del Gateway, que contiene información sobre qué métodos están decorados con \@OnConnect, \@OnDisconnect o \@SubscribeMessage, así como los patrones asociados a los métodos de mensajes. Esta metadata se usa para identificar qué métodos deben ser registrados como manejadores de eventos de conexión, desconexión y mensajes, y para construir el mapa de eventos que asocia patrones de mensajes con nombres de métodos manejadores.
 * @param eventRouter Mapa que se va a llenar con la asociación entre patrones de mensajes y nombres de métodos manejadores, que se usará posteriormente para resolver qué handler ejecutar cuando llegue un mensaje entrante con un patrón específico. La función se encarga de llenar este mapa con la información extraída de la metadata de eventos, asociando cada patrón definido en los métodos decorados con \@SubscribeMessage con el nombre del método correspondiente.
 * @returns Un objeto que contiene los nombres de los métodos manejadores de eventos de conexión, desconexión y mensajes sin patrón (firehose) extraídos de la metadata de eventos, que se usarán posteriormente para registrar esos eventos en el servidor de WebSockets. El objeto tiene la forma { onConnectMethod: string | null, onDisconnectMethod: string | null, firehoseMethod: string | null }, donde cada propiedad contiene el nombre del método correspondiente o null si no hay ningún método definido para ese tipo de evento.
 */
function mapGatewayEvents(
  events: WsEventHandlerMetadata[],
  eventRouter: Map<string, string>,
) {
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

  return { onConnectMethod, onDisconnectMethod, firehoseMethod };
}

export function registerGateways(
  app: FastifyInstance,
  gateways: Constructor[],
) {
  setupHeartbeatAndTeardown(app);

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

    // Mapeamos la metadata de eventos del Gateway
    const { onConnectMethod, onDisconnectMethod, firehoseMethod } =
      mapGatewayEvents(events, eventRouter);

    // Registramos la ruta del WebSocket en Fastify usando la configuración del decorador y el handler para gestionar las conexiones entrantes, mensajes y desconexiones
    app.get(
      options.path,
      { websocket: true },
      (connection: WebSocket, request: FastifyRequest) => {
        (connection as any).isAlive = true;

        // Registramos el handler de @OnConnect() para que se ejecute cuando un cliente se conecte
        if (onConnectMethod) {
          executeLifecycleMethod(
            onConnectMethod,
            GatewayClass,
            instance,
            metadata,
            request,
            connection,
            true,
          );
        }

        connection.on("message", async (rawMessage: Buffer) => {
          await processIncomingMessage({
            rawMessage,
            GatewayClass,
            instance,
            metadata,
            request,
            connection,
            adapter,
            eventRouter,
            firehoseMethod,
          });
        });

        // Evento de desconexión del cliente
        connection.on("close", async () => {
          if (onDisconnectMethod) {
            await executeLifecycleMethod(
              onDisconnectMethod,
              GatewayClass,
              instance,
              metadata,
              request,
              connection,
              false,
            );
          }
        });

        // Evento de ping recibido del cliente para mantener viva la conexión.
        connection.on("pong", () => {
          (connection as any).isAlive = true;
        });
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
