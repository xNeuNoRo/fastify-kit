import { Cron } from "croner";
import fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import { fastifyKitRequestContext } from "../http/plugins/requestContext.js";
import { fastifyKitErrorHandler } from "../http/plugins/errorHandler.js";
import {
  registerControllers,
  type Constructor,
} from "../http/routing/scanner/index.js";
import { discoverControllers, discoverModules } from "./discovery.js";
import { registerGateways } from "../websockets/gateway.registry.js";
import { container } from "../container/DIContainer.js";
import { requestContext } from "../http/context/requestContext.js";
import type {
  ModuleOptions,
  FastifyKitMetadata,
} from "../http/decorators/types.js";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyCookieOptions } from "@fastify/cookie";
import type { FastifyJWTOptions } from "@fastify/jwt";
import type { FastifyMultipartOptions } from "@fastify/multipart";
import type { CreateRateLimitOptions } from "@fastify/rate-limit";
import type { FastifyCorsOptions } from "@fastify/cors";
import type { FastifyHelmetOptions } from "@fastify/helmet";
import type { ServerOptions as HttpsServerOptions } from "node:https";
import type { TSchema } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { ConfigRegistry } from "../config/ConfigRegistry.js";
import { Value } from "@sinclair/typebox/value";
import { FastifyKitWebRtcConfig } from "./interfaces/webrtc.interface.js";

export interface FastifyKitOptions {
  module: Constructor;
  envSchema?: TSchema;
  globalPrefix?: string;
  swagger?: {
    title: string;
    description: string;
    version: string;
    [key: string]: any;
  };
  security?: {
    enableCors?: boolean | FastifyCorsOptions;
    enableHelmet?: boolean | FastifyHelmetOptions;
    rateLimit?: CreateRateLimitOptions;
  };
  multipart?: boolean | "keyValues" | FastifyMultipartOptions;
  cookies?: boolean | FastifyCookieOptions;
  jwt?: boolean | FastifyJWTOptions;
  fastifyOptions?: FastifyServerOptions & {
    http2?: boolean;
    https?: HttpsServerOptions | null;
  };
  // Activar o desactivar el manejo de websockets del framework
  websockets?:
    | boolean
    | {
        maxPayload?: number; // Tamaño máximo de payload en bytes para mensajes de WebSocket (opcional, por defecto 10MB)
      };

  webrtc?: boolean | FastifyKitWebRtcConfig;
}

type LifecycleHookName =
  | "onModuleInit"
  | "onApplicationBootstrap"
  | "onServerReady"
  | "beforeApplicationShutdown"
  | "onApplicationShutdown";

const LIFECYCLE_HOOKS: LifecycleHookName[] = [
  "onModuleInit",
  "onApplicationBootstrap",
  "onServerReady",
  "beforeApplicationShutdown",
  "onApplicationShutdown",
];

export const FASTIFY_INSTANCE_TOKEN = Symbol("FastifyInstance");

export class FastifyKit {
  // Usamos un símbolo para almacenar la metadata de los módulos y
  // evitar conflictos con otras propiedades de la clase.
  // Este símbolo es único y no colisionará con ninguna otra propiedad,
  // lo que garantiza que la metadata se almacene de manera segura y aislada en cada clase de módulo.
  private static readonly METADATA_SYMBOL: symbol =
    (Symbol as SymbolConstructor & { metadata?: symbol }).metadata ??
    Symbol.for("Symbol.metadata");

  private static readonly defaultHelmetConfig: FastifyHelmetOptions = {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        imgSrc: ["'self'", "data:", "validator.swagger.io"],
      },
    },
  };

  /**
   * @description Método estático para crear una instancia de Fastify configurada con FastifyKit. Este método se encarga de registrar los plugins necesarios para el manejo de contexto de solicitud, manejo de errores, seguridad (CORS, Helmet, rate limit) y documentación (Swagger/Scalar) según las opciones proporcionadas. También registra una ruta de health check y las rutas definidas en los controladores escaneados.
   * @param options Las opciones de configuración para FastifyKit, incluyendo los controladores a registrar, prefijo global para las rutas, configuración de Swagger/Scalar y opciones de seguridad.
   * @example
   * FastifyKit.create({
   * globalPrefix: "/api/v1",
   * controllers: [BookController],
   *
   * // Configuración de alto nivel
   * security: {
   *  enableCors: true,
   *   enableHelmet: true,
   *   rateLimit: { max: 100, timeWindow: "1 minute" }
   * },
   * 
   * swagger: {
   *   title: "Books API",
   *   description: "API de alto rendimiento con FastifyKit",
   *   version: "1.0.0"
   * },
   *
   * // Solo lo que es único de este servidor (Certs)
   * fastifyOptions: {
   *   http2: true,
   *   https: {
   *     key: fs.readFileSync("./localhost+2-key.pem"),
   *     cert: fs.readFileSync("./localhost+2.pem"),
   *   }
   * }
  });
   * @returns Una instancia de Fastify configurada y lista para ser utilizada como servidor de la API.
   */
  static async create(
    options: FastifyKitOptions,
  ): Promise<FastifyInstance<any, any, any, any, TypeBoxTypeProvider>> {
    if (options.envSchema) {
      this.validateAndLoadEnvironment(options.envSchema);
    }

    const userAjv = options.fastifyOptions?.ajv;
    const isAjvObject = typeof userAjv === "object" && userAjv !== null;

    const app = fastify({
      ...options.fastifyOptions,
      ajv: {
        // Preservamos las opciones ajv del usuario (si existen)
        ...(isAjvObject ? userAjv : {}),
        customOptions: {
          // Preservamos las customOptions del usuario (si existen)
          ...(isAjvObject ? userAjv.customOptions : {}),
          strict: false, // Forzamos nuestro requerimiento crítico para TypeBox
        },
      } as FastifyServerOptions["ajv"],
    }).withTypeProvider<TypeBoxTypeProvider>();

    // Registramos la instancia de Fastify en el contenedor de inyección de dependencias para que pueda ser inyectada en cualquier controlador o proveedor utilizando el token FASTIFY_INSTANCE_TOKEN.
    container.registerInstance(FASTIFY_INSTANCE_TOKEN, app);

    // Escaneamos todos los módulos y submódulos para obtener la lista completa de controladores a registrar en Fastify. Esto permite que el usuario solo tenga que especificar el módulo raíz en las opciones, y la Factory se encargará de descubrir todos los controladores en el árbol de módulos.
    const { allControllers, allProviders } = await this.bootstrapModule(
      options.module,
    );

    if (options.webrtc) {
      // Forzamos la activación del plugin de WebSockets si el usuario ha activado la opción de WebRTC,
      // ya que el módulo de WebRTC depende de los gateways de WebSocket para funcionar correctamente.
      options.websockets = true;

      const webrtcConfig =
        typeof options.webrtc === "object" ? options.webrtc : {};

      // Guardamos la configuración de WebRTC en el ConfigRegistry
      ConfigRegistry.set("webrtc_user_config", webrtcConfig);

      // Si el usuario ha activado la opción de useDefaultGateway,
      // inyectamos automáticamente el DefaultWebRtcGateway en el contenedor
      // de inyección de dependencias y lo registramos como un WebSocket Gateway
      // para que el usuario pueda usarlo sin tener que definirlo ni registrarlo manualmente.
      if (webrtcConfig.useDefaultGateway) {
        // Usamos importación dinámica (Lazy Load) para no cargar Mediasoup si WebRTC está apagado
        const { DefaultWebRtcGateway } =
          await import("../webrtc/gateways/DefaultWebRtcGateway.js");
        const { SFU_ROOM_MANAGER_TOKEN } =
          await import("../webrtc/interfaces/SfuRoomManager.js");
        const { AdvancedSfuRoomManager } =
          await import("../webrtc/managers/AdvancedSfuRoomManager.js");

        // Lo registramos en el DI Container
        container.registerClass(DefaultWebRtcGateway, DefaultWebRtcGateway);

        // Registramos el Manager por defecto para WebRTC
        container.registerClass(SFU_ROOM_MANAGER_TOKEN, AdvancedSfuRoomManager);

        // Registramos el Gateway por defecto para WebRTC
        // como un WebSocket Gateway utilizando su token de inyección de dependencias.
        if (!allProviders.some((p) => p.token === DefaultWebRtcGateway)) {
          allProviders.push({
            token: DefaultWebRtcGateway,
            implementation: DefaultWebRtcGateway,
          });
        }

        // Registramos el Manager por defecto para WebRTC como un provider normal
        // para que pueda ser inyectado en cualquier parte de la aplicación utilizando su token de inyección de dependencias.
        if (!allProviders.some((p) => p.token === SFU_ROOM_MANAGER_TOKEN)) {
          allProviders.push({
            token: SFU_ROOM_MANAGER_TOKEN,
            implementation: AdvancedSfuRoomManager,
          });
        }
      }
    }

    // Registramos los plugins esenciales
    await this.registerCorePlugins(app, options);

    // Set para almacenar las instancias de los controladores y proveedores
    // que implementen hooks de ciclo de vida, para luego ejecutar esos hooks en el orden correcto.
    const lifecycleInstances = new Set<object>();

    // Recorremos los controladores y providers para agregarlos al set de instancias de ciclo de vida.
    for (const Controller of allControllers) {
      if (this.hasLifecycleHook(Controller)) {
        lifecycleInstances.add(container.resolve(Controller));
      }
    }
    for (const provider of allProviders) {
      if (this.hasLifecycleHook(provider.implementation)) {
        lifecycleInstances.add(
          container.resolve(provider.token as Constructor),
        );
      }
    }

    // Ejecutamos el lifecycle hook onModuleInit antes de que se registre cualquier plugin o ruta en Fastify
    await this.executeLifecycleHook(lifecycleInstances, "onModuleInit");

    // Registramos los controladores escaneados con el prefijo global configurado (si se proporciona) para organizar mejor las rutas de la API
    const prefix = options.globalPrefix || "";
    await app.register(
      async (instance) => {
        registerControllers(instance, allControllers);
      },
      { prefix },
    );

    // Si el usuario ha activado el soporte para WebSockets, buscamos en todos los controladores
    // y proveedores registrados aquellos que tengan el decorador @WebSocketGateway y los registramos utilizando la función registerGateways.
    if (options.websockets) {
      this.registerWebSocketGateways(app, allControllers, allProviders);
    }

    // Finalmente, configuramos las tareas programadas (cron jobs)
    // definidas en los proveedores de los módulos. Esto se hace al final
    // para asegurarnos de que todos los proveedores estén registrados e
    // instanciados correctamente antes de iniciar las tareas programadas.
    this.setupScheduledTasks(app, allProviders);

    // Inicializamos el hook onApplicationBootstrap justo antes de que el servidor comience a escuchar peticiones.
    await this.executeLifecycleHook(
      lifecycleInstances,
      "onApplicationBootstrap",
    );

    // Inicializamos el hook onServerReady justo después de que el servidor ya está escuchando en el puerto
    app.addHook("onListen", async () => {
      await this.executeLifecycleHook(lifecycleInstances, "onServerReady");
    });

    let receivedSignal: string | undefined;

    // Inicializamos el hook onApplicationShutdown justo antes de que el servidor se cierre,
    // pasando la señal recibida para que las instancias puedan realizar tareas de limpieza
    // o sacar el nodo de un Load Balancer antes de que deje de aceptar nuevas peticiones.
    app.addHook("onClose", async () => {
      await this.executeLifecycleHook(
        lifecycleInstances,
        "onApplicationShutdown",
        receivedSignal,
      );
    });

    // Configuración para interceptar SIGTERM/SIGINT antes de que Fastify cierre el servidor,
    // para ejecutar el hook beforeApplicationShutdown en ese momento.
    this.setupGracefulShutdown(app, lifecycleInstances, (signal) => {
      receivedSignal = signal;
    });

    return app;
  }

  /**
   * @description Método privado para registrar los plugins esenciales en la instancia de Fastify, incluyendo multipart para manejo de archivos, cookies para manejo de cookies, websockets para manejo de gateways de WebSocket, plugins personalizados para manejo de contexto de solicitud y manejo de errores, plugins de seguridad (CORS, Helmet, rate limit) según las opciones proporcionadas por el usuario, y el plugin de documentación (Swagger/Scalar) si se ha configurado la opción de Swagger.
   * @param app La instancia de Fastify en la que se registrarán los plugins esenciales. Esta instancia se va a configurar con los plugins necesarios para el funcionamiento de FastifyKit, y luego se devolverá para que el usuario pueda usarla como su servidor de API.
   * @param options Las opciones de configuración para FastifyKit, que incluyen la activación de multipart, cookies, websockets, seguridad y documentación. Estas opciones se utilizan para determinar qué plugins registrar en la instancia de Fastify y con qué configuraciones específicas.
   */
  private static async registerCorePlugins(
    app: FastifyInstance<any, any, any, any, TypeBoxTypeProvider>,
    options: FastifyKitOptions,
  ) {
    // Si el usuario activa multipart, registramos el plugin de multipart para manejar la carga de archivos en los controladores.
    if (options.multipart) {
      const multipartConfig =
        typeof options.multipart === "object" ? options.multipart : {};

      await app.register(import("@fastify/multipart"), {
        ...multipartConfig,
        attachFieldsToBody: multipartConfig.attachFieldsToBody ?? false, // Por defecto, no adjuntamos los campos al body para evitar conflictos con los decoradores de parámetros
      });
    }

    // Si el usuario activa cookies, registramos el plugin de cookies para manejar las cookies en los controladores.
    if (options.cookies) {
      const cookieConfig =
        typeof options.cookies === "object" ? options.cookies : {};
      await app.register(import("@fastify/cookie"), {
        ...cookieConfig,
      });
    }

    // Si el usuario activa JWT, registramos el plugin de JWT para manejar la autenticación basada en tokens en los controladores.
    if (options.jwt) {
      const jwtConfig =
        typeof options.jwt === "object"
          ? options.jwt
          : ({} as FastifyJWTOptions);
      await app.register(import("@fastify/jwt"), jwtConfig);
    }

    // Si el usuario activa websockets, registramos el plugin de websockets para manejar los gateways
    // de WebSocket definidos en los controladores y proveedores de los módulos.
    if (options.websockets) {
      const wsConfig =
        typeof options.websockets === "object" ? options.websockets : {};

      await app.register(import("@fastify/websocket"), {
        options: {
          maxPayload: wsConfig.maxPayload ?? 10 * 1024 * 1024, // Por defecto, 10MB
        },
      });
    }

    // Registramos los plugins personalizados para manejo de contexto de solicitud y manejo de errores
    await app.register(fastifyKitRequestContext);
    await app.register(fastifyKitErrorHandler);

    // Registramos los plugins de seguridad
    await this.registerSecurityPlugins(app, options.security);

    // Registramos el plugin de documentación (Swagger/Scalar)
    // si el usuario ha proporcionado la configuración de Swagger en las opciones.
    await this.registerDocumentationPlugin(app, options);
  }

  /**
   * @description Método privado para registrar los plugins de seguridad (CORS, Helmet, rate limit) según las opciones proporcionadas por el usuario.
   * @param app La instancia de Fastify en la que se registrarán los plugins de seguridad. Se utiliza para llamar a app.register con cada plugin de seguridad activado en las opciones.
   * @param securityOptions Las opciones de seguridad proporcionadas por el usuario en las opciones de FastifyKit. Estas opciones pueden incluir la activación de CORS, Helmet y rate limit, así como sus configuraciones específicas. El método verifica cada una de estas opciones y registra el plugin correspondiente si están activadas.
   */
  private static async registerSecurityPlugins(
    app: FastifyInstance<any, any, any, any, TypeBoxTypeProvider>,
    securityOptions?: FastifyKitOptions["security"],
  ) {
    // Si el usuario activa CORS, registramos el plugin de CORS
    // para permitir solicitudes desde otros orígenes según la configuración proporcionada.
    if (securityOptions?.enableCors) {
      // Si el usuario pasó un objeto de configuración para CORS, lo usamos.
      // Si solo pasó "true", usamos una configuración básica que permite cualquier origen (origin: true).
      const corsConfig =
        typeof securityOptions.enableCors === "object"
          ? securityOptions.enableCors
          : { origin: true };
      await app.register(import("@fastify/cors"), corsConfig);
    }

    // Si el usuario activa Helmet, registramos el plugin de Helmet para agregar headers de seguridad a las respuestas
    if (securityOptions?.enableHelmet) {
      // Si el usuario pasó un objeto de configuración para Helmet, lo usamos.
      const helmetConfig =
        typeof securityOptions.enableHelmet === "object"
          ? securityOptions.enableHelmet
          : FastifyKit.defaultHelmetConfig;

      await app.register(import("@fastify/helmet"), helmetConfig);
    }

    // Si el usuario activa rate limit, registramos el plugin de rate limit para limitar la cantidad de peticiones por IP y evitar abusos
    if (securityOptions?.rateLimit) {
      await app.register(import("@fastify/rate-limit"), {
        ...securityOptions.rateLimit,
      });
    }
  }

  /**
   * @description Método privado para registrar el plugin de documentación (Swagger/Scalar) si el usuario ha proporcionado la configuración de Swagger en las opciones.
   * @param app La instancia de Fastify en la que se registrará el plugin de documentación. Se utiliza para llamar a app.register con el plugin de Swagger y Scalar si se ha configurado.
   * @param options Las opciones de configuración para FastifyKit, que incluyen la configuración de Swagger en la propiedad "swagger". Si esta propiedad está presente, se registrará el plugin de documentación.
   */
  private static async registerDocumentationPlugin(
    app: FastifyInstance<any, any, any, any, TypeBoxTypeProvider>,
    options: FastifyKitOptions,
  ) {
    // Si el usuario activa Swagger/Scalar, registramos el plugin de Scalar para generar una documentación interactiva y visualmente atractiva de la API en la ruta /docs
    if (options.swagger) {
      await app.register(import("@fastify/swagger"), {
        openapi: {
          openapi: "3.0.0",
          info: options.swagger,
        },
      });
      await app.register(import("@scalar/fastify-api-reference"), {
        routePrefix: "/docs",
        configuration: {
          theme: "purple",
          layout: "modern",
          metaData: { title: options.swagger.title },
        },
      });
    }
  }

  /**
   * @description Método privado para registrar los gateways de WebSocket definidos en los controladores y proveedores de los módulos. Este método recorre todos los controladores y proveedores registrados, verifica si tienen el decorador \@WebSocketGateway definido en su metadata, y si es así, los registra utilizando la función registerGateways. Esto permite que el usuario pueda definir gateways de WebSocket en cualquier controlador o proveedor de sus módulos, y la Factory se encargará de descubrirlos y registrarlos automáticamente si ha activado el soporte para WebSockets en las opciones.
   * @param app La instancia de Fastify en la que se registrarán los gateways de WebSocket. Se utiliza para llamar a la función registerGateways con los gateways encontrados en los controladores y proveedores.
   * @param allControllers El array de controladores registrados en los módulos, que se revisará para encontrar aquellos que tengan el decorador \@WebSocketGateway definido en su metadata. Cada controlador es una clase que puede tener métodos decorados como handlers de WebSocket.
   * @param allProviders El array de proveedores registrados en los módulos, que se revisará para encontrar aquellos que tengan el decorador \@WebSocketGateway definido en su metadata. Cada proveedor es un objeto que contiene un token y una implementación, y la implementación es la clase que se revisará para encontrar el decorador de WebSocket.
   */
  private static registerWebSocketGateways(
    app: FastifyInstance<any, any, any, any, TypeBoxTypeProvider>,
    allControllers: Constructor[],
    allProviders: { token: any; implementation: Constructor }[],
  ) {
    // Unimos controladores y proveedores porque un Gateway puede ser registrado como cualquiera de los dos en el decorador @Module
    const allClasses = [
      ...allControllers,
      ...allProviders.map((p) => p.implementation),
    ];

    // Filtramos las clases que tienen el decorador @WebSocketGateway
    const gateways = allClasses.filter((Clase) => {
      const metadata = (Clase as any)[
        this.METADATA_SYMBOL
      ] as FastifyKitMetadata;
      return !!metadata?.wsGateway;
    });

    // Si encontramos gateways, los registramos.
    if (gateways.length > 0) {
      registerGateways(app, gateways);
    } else {
      app.log.warn(
        "[FastifyKit WS] WebSockets activados en opciones, pero no se encontró ningún @WebSocketGateway en los módulos.",
      );
    }
  }

  /**
   * @description Método privado para configurar las tareas programadas (cron jobs) definidas en los proveedores de los módulos. Este método recorre todos los proveedores registrados, verifica si tienen tareas programadas definidas en su metadata, y si es así, instancia el proveedor (respetando el patrón Singleton) y configura un trabajo programado utilizando la expresión cron proporcionada. Además, se asegura de que cada tarea programada se ejecute dentro del contexto de solicitud adecuado para que puedan acceder a la información de la solicitud incluso cuando se ejecutan en segundo plano. Finalmente, se registra un hook para detener todos los trabajos programados cuando el servidor se detenga, evitando que sigan ejecutándose en segundo plano después de que la API haya cerrado.
   * @param app La instancia de Fastify en la que se configurarán las tareas programadas. Se utiliza para registrar los trabajos programados y el hook de cierre.
   * @param allProviders El array de proveedores registrados en los módulos, que se revisará para encontrar aquellos que tengan tareas programadas definidas en su metadata. Cada proveedor es un objeto que contiene un token y una implementación.
   */
  private static setupScheduledTasks(
    app: FastifyInstance<any, any, any, any, TypeBoxTypeProvider>,
    allProviders: { token: any; implementation: Constructor }[],
  ): void {
    // Array para almacenar los trabajos programados y poder detenerlos cuando el servidor se detenga
    const scheduledJobs: Cron[] = [];

    for (const provider of allProviders) {
      // Leemos la metadata directamente desde la implementación
      const providerMeta = (provider.implementation as any)[
        this.METADATA_SYMBOL
      ] as FastifyKitMetadata;

      if (providerMeta?.scheduledTasks?.length) {
        // Obligamos al contenedor a instanciar la clase AHORA (Eager Loading)
        // usando el token para respetar el Singleton
        const instance = container.resolve(provider.token);

        for (const task of providerMeta.scheduledTasks) {
          // Iniciamos el temporizador en segundo plano
          const job = new Cron(task.cronExpression, async () => {
            const store = new Map<string, any>();
            store.set("requestId", `cron-${crypto.randomUUID()}`);

            await requestContext.run(store, async () => {
              try {
                await (instance as any)[task.methodName]();
              } catch (err) {
                app.log.error(
                  { err },
                  // Usamos implementation.name para que el log sea legible (ej: CacheService.limpiar)
                  `[FastifyKit Cron] Error en tarea programada ${provider.implementation.name}.${String(task.methodName)}:`,
                );
              }
            });
          });

          // Guardamos el trabajo programado para poder detenerlo cuando el servidor se detenga
          scheduledJobs.push(job);

          app.log.info(
            // Usamos implementation.name aquí también
            `[FastifyKit Cron] Tarea programada registrada: ${provider.implementation.name}.${String(task.methodName)} (${task.cronExpression})`,
          );
        }
      }
    }

    // Cuando el servidor se detenga, detenemos todos los trabajos programados
    // para evitar que sigan ejecutándose en segundo plano después de que la API haya cerrado.
    app.addHook("onClose", async () => {
      for (const job of scheduledJobs) {
        job.stop();
      }
    });

    app.log.info("[FastifyKit] kit inicializado correctamente!");
    return app as any;
  }

  /**
   * @description Método privado para validar las variables de entorno utilizando el esquema proporcionado por el usuario en las opciones de FastifyKit. Este método extrae solo las variables de entorno definidas en el esquema, coerciona sus valores según los tipos definidos en el esquema (ej: números, booleanos), y luego valida el entorno coercionado contra el esquema utilizando TypeBox. Si la validación falla, se extraen los errores y se muestran de manera clara en la consola, indicando qué variable no pasó la validación, cuál era el tipo esperado y cuál fue el mensaje de error. Finalmente, se aborta la inicialización del servidor para evitar que se ejecute con una configuración de entorno incorrecta. Si la validación es exitosa, las variables de entorno coercionadas y validadas se registran individualmente en el ConfigRegistry para que puedan ser accedidas de manera tipada en cualquier parte del código.
   * @param envSchema El esquema de validación de las variables de entorno proporcionado por el usuario en las opciones de FastifyKit. Este esquema debe ser un TSchema de TypeBox que defina las variables de entorno esperadas, sus tipos y cualquier otra validación necesaria. El método utiliza este esquema para validar y coercionar las variables de entorno antes de registrar su valor en el ConfigRegistry.
   */
  private static validateAndLoadEnvironment(envSchema: TSchema): void {
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

    // Registramos individualmente cada variable de entorno validada y coercionada en el
    // ConfigRegistry para que puedan ser accedidas de manera tipada en cualquier parte
    // Con el decorador @InjectConfig("VARIABLE") o directamente con ConfigRegistry.get("VARIABLE")
    for (const [key, value] of Object.entries(
      coercedEnv as Record<string, any>,
    )) {
      ConfigRegistry.set(key, value);
    }
  }

  /**
   * @description Método privado recursivo para bootstrappear un módulo y sus submódulos, registrando sus controladores y proveedores en el contenedor de inyección de dependencias. Este método se encarga de evitar ciclos en el árbol de módulos utilizando un conjunto de módulos visitados, y fusiona los controladores explícitos definidos en cada módulo con los controladores descubiertos automáticamente si se ha configurado el auto-discover.
   * @param moduleClass La clase del módulo a bootstrappear. Esta clase debe estar decorada con \@Module para que la Factory pueda extraer sus opciones y metadata.
   * @param visited Un conjunto de módulos que ya han sido visitados en el proceso de bootstrap para evitar ciclos en el árbol de módulos. Se inicializa como un conjunto vacío en la llamada inicial.
   * @returns Un objeto que contiene un array con todos los controladores encontrados en el módulo y sus submódulos, listo para ser registrado en Fastify.
   */
  private static async bootstrapModule(
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
    if (visited.has(moduleClass))
      return { allControllers: [], allProviders: [] };
    visited.add(moduleClass);

    const metadata = this.getModuleMetadata(moduleClass);
    const currentProviders = this.registerModuleProviders(
      metadata.providers,
      moduleClass,
    );
    for (const provider of currentProviders) {
      // Agregamos el proveedor al mapa global para evitar duplicados en submódulos
      if (!globalProvidersMap.has(provider.token)) {
        globalProvidersMap.set(provider.token, provider);
      }
    }
    const [localControllers, allModules] = await Promise.all([
      this.collectModuleControllers(metadata),
      this.collectModuleImports(metadata),
    ]);

    // Agregamos los controladores locales al conjunto global para evitar duplicados en submódulos
    for (const controller of localControllers) {
      globalControllers.add(controller);
    }

    // Bootstrappeamos recursivamente los submódulos, pasándoles las referencias globales para que puedan agregar sus controladores y proveedores sin duplicados.
    for (const subModule of allModules) {
      await this.bootstrapModule(
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
  private static getModuleMetadata(moduleClass: any): ModuleOptions {
    const metadata = moduleClass[this.METADATA_SYMBOL]
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
  private static registerModuleProviders(
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
  private static async collectModuleControllers(
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
   * @description Función auxiliar para recolectar los módulos importados por un módulo, combinando los módulos importados explícitamente en las opciones del módulo con los módulos descubiertos automáticamente si se ha configurado el auto-discover. Esta función permite que el usuario tenga la flexibilidad de definir manualmente algunos módulos importados en el módulo, mientras que la Factory se encarga de descubrir automáticamente otros módulos en el directorio especificado sin que el usuario tenga que listarlos todos manualmente.
   * @param metadata La metadata del módulo extraída de su clase, que incluye las opciones definidas en el decorador \@Module, como módulos importados explícitos y configuración de auto-discover.
   * @returns Un array de las clases de los módulos importados por este módulo, listo para ser bootstrappeado recursivamente. Este array incluye tanto los módulos importados explícitamente en las opciones del módulo como los módulos descubiertos automáticamente si se ha configurado el auto-discover. Si no se han definido módulos importados explícitos ni se ha configurado el auto-discover, el array estará vacío.
   */
  private static async collectModuleImports(
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

  /**
   * @description Verifica si una clase (no instanciada) implementa al menos un hook de ciclo de vida
   * escaneando directamente su prototipo. Evita instanciaciones innecesarias (Eager Loading).
   * @param targetClass La clase a verificar, que puede ser un controlador o proveedor registrado en los módulos.
   */
  private static hasLifecycleHook(targetClass: Constructor): boolean {
    // Si no tiene prototipo quiere decir que no es una clase valida
    if (!targetClass?.prototype) return false;

    // Iteramos hasta encontrar en el prototipo de la clase un metodo que coincida con el hook proporcionado
    for (const hook of LIFECYCLE_HOOKS) {
      if (typeof targetClass.prototype[hook] === "function") {
        return true;
      }
    }
    return false;
  }

  /**
   * @description Función auxiliar para ejecutar los hooks de ciclo de vida (onModuleInit, onApplicationBootstrap, onServerReady, beforeApplicationShutdown, onApplicationShutdown) en las instancias que los implementen. Esta función recorre un conjunto de instancias, verifica si cada instancia tiene el hook definido como un método, y si es así, lo ejecuta pasando los argumentos necesarios. Si la ejecución de algún hook falla, se captura el error, se muestra un mensaje claro en la consola indicando qué hook falló y en qué clase, y luego se lanza el error para que pueda ser manejado por el sistema de manejo de errores global.
   * @param instances Un conjunto de instancias de controladores o proveedores que pueden implementar los hooks de ciclo de vida. Estas instancias se revisarán para verificar si implementan alguno de los hooks definidos, y si es así, se ejecutarán.
   * @param hookName El nombre del hook de ciclo de vida a ejecutar.
   * @param args Los argumentos a pasar al hook.
   */
  private static async executeLifecycleHook(
    instances: Set<object>,
    hookName: LifecycleHookName,
    ...args: unknown[]
  ): Promise<void> {
    // Recorremos todas las instancias para ejecutar el hook correspondiente en aquellas que lo implementen.
    for (const instance of instances) {
      if (
        instance && // Verificamos que la instancia es un objeto y que tiene el hook definido como un método
        typeof instance === "object" &&
        hookName in instance &&
        typeof (instance as Record<string, unknown>)[hookName] === "function"
      ) {
        try {
          const method = (instance as Record<string, Function>)[hookName]; // Obtenemos el método del hook de la instancia
          await method.apply(instance, args); // Ejecutamos el hook pasando los argumentos necesarios
        } catch (error) {
          console.error(
            `[FastifyKit Lifecycle Error] Falla en ${hookName} de la clase ${instance.constructor.name}:`,
            error,
          );
          throw error;
        }
      }
    }
  }

  /**
   * @description Método privado para configurar el apagado elegante (Graceful Shutdown) del servidor Fastify. Este método escucha las señales de terminación del proceso (SIGTERM, SIGINT), y cuando se reciben, ejecuta los hooks de ciclo de vida beforeApplicationShutdown en las instancias que los implementen para permitirles realizar tareas de limpieza o sacar el nodo de un Load Balancer antes de que el servidor deje de aceptar nuevas peticiones. Luego, intenta cerrar la instancia de Fastify de manera ordenada, y si ocurre algún error durante el cierre, lo captura y muestra un mensaje claro en la consola antes de forzar la salida del proceso con un código de error.
   * @param app La instancia de Fastify en la que se configurará el manejo del apagado elegante. Se utiliza para llamar a app.close() cuando se recibe una señal de terminación, y para registrar los hooks de ciclo de vida relacionados con el apagado.
   * @param instances Un conjunto de instancias de controladores o proveedores que pueden implementar el hook beforeApplicationShutdown. Estas instancias se revisarán para ejecutar este hook cuando se reciba una señal de terminación, permitiéndoles realizar tareas de limpieza o sacar el nodo de un Load Balancer antes de que el servidor deje de aceptar nuevas peticiones.
   */
  private static setupGracefulShutdown(
    app: FastifyInstance<any, any, any, any, TypeBoxTypeProvider>,
    instances: Set<object>,
    onSignalReceived: (signal: string) => void,
  ): void {
    // Guardamos las señales que queremos escuchar para el apagado
    const signals = ["SIGTERM", "SIGINT"] as const;

    // Map para almacenar los handlers de las signals y poder removerlos si es necesario
    const handlers = new Map<string, NodeJS.SignalsListener>();

    // Iteramos en todas las señales y configuramos un listener para cada una de ellas
    for (const signal of signals) {
      const handler: NodeJS.SignalsListener = () => {
        void (async () => {
          try {
            // Pasamos la señal recibida al callback
            onSignalReceived(signal);

            // Ejecutamos el hook beforeApplicationShutdown en las instancias que lo implementen, pasando la señal como argumento para que puedan realizar tareas de limpieza o sacar el nodo de un Load Balancer antes de que el servidor deje de aceptar nuevas peticiones.
            await this.executeLifecycleHook(
              instances,
              "beforeApplicationShutdown",
              signal,
            );

            // Finalmente cerramos la instancia de Fastify
            await app.close();
            // Si el cierre es exitoso, salimos del proceso con código 0
            process.exit(0);
          } catch (error) {
            console.error(
              `[FastifyKit] Error crítico durante el apagado:`,
              error,
            );
            process.exit(1);
          }
        })();
      };

      // Guardamos el handler en el map para poder removerlo si es necesario
      handlers.set(signal, handler);
      // Iniciamos el proceso de apagado llamando al handler una sola vez
      process.once(signal, handler);
    }

    // Removemos los listeners de las signals cuando la app se cierre para evitar memory leaks en caso de reinicios o cierres múltiples (mas que nada en tests)
    app.addHook("onClose", async () => {
      for (const [signal, handler] of handlers.entries()) {
        process.removeListener(signal, handler);
      }
    });
  }
}
