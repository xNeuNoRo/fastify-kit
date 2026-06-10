import ajvFormats from "ajv-formats";
import fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import {
  registerControllers,
  type Constructor,
} from "../http/routing/scanner/index.js";
import { container } from "../container/DIContainer.js";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { FastifyCookieOptions } from "@fastify/cookie";
import type { FastifyJWTOptions } from "@fastify/jwt";
import type { FastifyMultipartOptions } from "@fastify/multipart";
import type { CreateRateLimitOptions } from "@fastify/rate-limit";
import type { FastifyCorsOptions } from "@fastify/cors";
import type { FastifyHelmetOptions } from "@fastify/helmet";
import type { ServerOptions as HttpsServerOptions } from "node:https";
import type { TSchema } from "@sinclair/typebox";
import type { StaticAssetsOptions } from "../http/interfaces/static.interface.js";
import type { FastifyKitWebRtcConfig } from "./interfaces/webrtc.interface.js";
import { InternalConfig } from "../config/InternalConfig.js";
import { QueueOptions } from "./interfaces/queue.interface.js";
import { DistributedOptions } from "./interfaces/distributed.interface.js";

// Bootstrap Functions
import { validateAndLoadEnvironment } from "./bootstrap/env.bootstrap.js";
import { registerCorePlugins } from "./bootstrap/plugins.bootstrap.js";
import { bootstrapModule } from "./bootstrap/discovery.bootstrap.js";
import {
  initializeCqrsModule,
  initializeWebRtcModule,
  initializeQueueModule,
  initializeDistributedModule,
} from "./bootstrap/modules.bootstrap.js";
import {
  hasLifecycleHook,
  executeLifecycleHook,
  setupGracefulShutdown,
  setupScheduledTasks,
  registerWebSocketGateways,
} from "./bootstrap/lifecycle.bootstrap.js";

export { FASTIFY_KIT_METADATA_SYMBOL } from "./constants/symbols.js";
export const defaultHelmetConfig = {
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

export interface FastifyKitOptions {
  /**
   * Modulo raiz de la app, desde donde se escanearán los controladores y proveedores
   * para registrarlos en Fastify. Este módulo debe estar decorado con el decorador
   * \@Module y es el punto de entrada para que FastifyKit descubra toda la estructura de módulos,
   * submódulos, controladores y proveedores de la aplicación.
   */
  module: Constructor;
  /**
   * Esquema de validación para las variables de entorno utilizando TypeBox.
   * Esto es util para evitar errores en tu API por falta de configuraciones en las variables de entorno
   * o por tenerlas mal configuradas (ej: un puerto como string en vez de número).
   */
  envSchema?: TSchema;
  /**
   * Prefix global para todas las rutas definidas en los controladores.
   * Ej: globalPrefix: "/api/v1" -> todas las rutas de los controladores estarán bajo /api/v1 (ej: GET /api/v1/books)
   */
  globalPrefix?: string;
  /**
   * Configuración para generar la documentación de la API utilizando Swagger/Scalar.
   */
  swagger?: {
    title: string;
    description: string;
    version: string;
    [key: string]: any;
  };
  /**
   * Opciones para configurar los plugins de seguridad en Fastify,
   * incluyendo CORS, Helmet y rate limit.
   * (\@fastify/cors, \@fastify/helmet, \@fastify/rate-limit)
   */
  security?: {
    enableCors?: boolean | FastifyCorsOptions;
    enableHelmet?: boolean | FastifyHelmetOptions;
    rateLimit?: CreateRateLimitOptions;
  };
  /**
   * Activar o desactivar el soporte para multipart/form-data en el framework.
   * \(@fastify/multipart)
   */
  multipart?: boolean | "keyValues" | FastifyMultipartOptions;
  /**
   * Activar o desactivar el soporte para cookies en el framework.
   * \(@fastify/cookie)
   */
  cookies?: boolean | FastifyCookieOptions;
  /**
   * Activar o desactivar el soporte para JWT en el framework.
   * \(@fastify/jwt)
   */
  jwt?: boolean | FastifyJWTOptions;
  /**
   * Opciones avanzadas para configurar la instancia de Fastify.
   */
  fastifyOptions?: FastifyServerOptions & {
    http2?: boolean;
    https?: HttpsServerOptions | null;
  };
  /**
   * Activar o desactivar el soporte para WebSockets en el framework.
   * Recibe un boolean para activar o desactivar o un objeto de config
   * para configurar el maximo tamaño de los mensajes de WebSocket (maxPayload)
   */
  websockets?:
    | boolean
    | {
        maxPayload?: number; // Tamaño máximo de payload en bytes para mensajes de WebSocket (opcional, por defecto 10MB)
      };
  /**
   * Activar o desactivar el soporte para WebRTC en el framework.
   * Si se activa, se registrarán automáticamente los managers necesarios para usar WebRTC sin configuracion adicionaL,
   * Tambien incluye un Gateway integrado por defecto para no configurar nada adicional si solo se quiere usar WebRTC básico.
   */
  webrtc?: boolean | FastifyKitWebRtcConfig;
  /**
   * Configuracion para servir archivos estáticos.
   * Puede ser la ruta a la carpeta de archivos estaticos para servir o un obj de configuracion mas detallado
   */
  staticAssets?: string | StaticAssetsOptions;
  /**
   * Configuracion para el motor de BackgroundJobs (Integrado en el framework)
   */
  queue?: QueueOptions;
  /**
   * Configuracion para el sistema distribuido a lo largo de funciones del framework
   */
  distributed?: DistributedOptions;
}

// Aseguramos que exista Symbol.metadata para
// almacenar la metadata de los módulos, controladores y proveedores.
if (!(Symbol as any).metadata) {
  (Symbol as any).metadata = Symbol.for("Symbol.metadata");
}

export const FASTIFY_INSTANCE_TOKEN = Symbol.for("FastifyInstance");

export class FastifyKit {
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
    // Registramos la configuracion distribuida en el registry interno para que los adapters/managers puedan usarla
    InternalConfig.set("distributed", options.distributed || {});

    if (options.envSchema) {
      validateAndLoadEnvironment(options.envSchema);
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
        plugins: [
          [(ajvFormats as any).default ?? ajvFormats, { mode: "fast" }],
        ] as unknown as any[],
      } as FastifyServerOptions["ajv"],
    }).withTypeProvider<TypeBoxTypeProvider>();

    // Escaneamos todos los módulos y submódulos para obtener la lista completa de controladores a registrar en Fastify.
    const { allControllers, allProviders } = await bootstrapModule(
      options.module,
    );

    // Inicializamos el módulo de CQRS integrado en FastifyKit
    await initializeCqrsModule(allProviders);

    // Inicializamos el módulo de WebRTC integrado en FastifyKit
    await initializeWebRtcModule(options, allProviders);

    // Inicializamos el módulo de colas (BackgroundJobs)
    await initializeQueueModule(options, allControllers, allProviders);

    // Inicializamos el módulo distribuido (EventBus, etc.)
    await initializeDistributedModule(options, allProviders);

    // Registramos la instancia de Fastify en el contenedor de inyección de dependencias para que pueda ser inyectada en cualquier controlador o proveedor utilizando el token FASTIFY_INSTANCE_TOKEN.
    container.registerInstance(FASTIFY_INSTANCE_TOKEN, app);

    // Registramos los plugins esenciales
    await registerCorePlugins(app, options);

    // Set para almacenar las instancias de los controladores y proveedores
    // que implementen hooks de ciclo de vida, para luego ejecutar esos hooks en el orden correcto.
    const lifecycleInstances = new Set<object>();

    // Recorremos los controladores y providers para agregarlos al set de instancias de ciclo de vida.
    for (const Controller of allControllers) {
      if (hasLifecycleHook(Controller)) {
        lifecycleInstances.add(container.resolve(Controller));
      }
    }
    for (const provider of allProviders) {
      if (hasLifecycleHook(provider.implementation)) {
        lifecycleInstances.add(
          container.resolve(provider.token as Constructor),
        );
      }
    }

    // Ejecutamos el lifecycle hook onModuleInit antes de que se registre cualquier plugin o ruta en Fastify
    await executeLifecycleHook(lifecycleInstances, "onModuleInit");

    // Registramos los controladores escaneados con el prefijo global configurado (si se proporciona) para organizar mejor las rutas de la API
    const prefix = options.globalPrefix || "";
    await app.register(
      async (instance) => {
        await registerControllers(instance, allControllers);
      },
      { prefix },
    );

    // Si el usuario ha activado el soporte para WebSockets, buscamos en todos los controladores
    // y proveedores registrados aquellos que tengan el decorador @WebSocketGateway y los registramos utilizando la función registerGateways.
    if (options.websockets) {
      registerWebSocketGateways(app, allControllers, allProviders);
    }

    // Finalmente, configuramos las tareas programadas (cron jobs)
    // definidas en los proveedores de los módulos. Esto se hace al final
    // para asegurarnos de que todos los proveedores estén registrados e
    // instanciados correctamente antes de iniciar las tareas programadas.
    setupScheduledTasks(app, allProviders);

    // Inicializamos el hook onApplicationBootstrap justo antes de que el servidor comience a escuchar peticiones.
    await executeLifecycleHook(lifecycleInstances, "onApplicationBootstrap");

    // Inicializamos el hook onServerReady justo después de que el servidor ya está escuchando en el puerto
    app.addHook("onListen", async () => {
      await executeLifecycleHook(lifecycleInstances, "onServerReady");
    });

    let receivedSignal: string | undefined;

    // Inicializamos el hook onApplicationShutdown justo antes de que el servidor se cierre,
    // pasando la señal recibida para que las instancias puedan realizar tareas de limpieza
    // o sacar el nodo de un Load Balancer antes de que deje de aceptar nuevas peticiones.
    app.addHook("onClose", async () => {
      // Primero ejecutamos el hook "before" para limpieza de infraestructura
      await executeLifecycleHook(
        lifecycleInstances,
        "beforeApplicationShutdown",
        receivedSignal,
      );

      // Luego el hook final de apagado
      await executeLifecycleHook(
        lifecycleInstances,
        "onApplicationShutdown",
        receivedSignal,
      );
    });

    // Configuración para interceptar SIGTERM/SIGINT antes de que Fastify cierre el servidor,
    // Esto disparará app.close() que a su vez ejecutará los hooks de arriba.
    setupGracefulShutdown(app, (signal) => {
      receivedSignal = signal;
    });

    return app;
  }
}
