import { type Constructor } from "../../http/routing/scanner/index.js";
import { container } from "../../container/DIContainer.js";
import type { FastifyKitMetadata } from "../../http/decorators/types.js";
import {
  CONFIG_SERVICE_TOKEN,
  type ConfigService,
} from "../../config/ConfigService.js";
import { QueueOptions } from "../interfaces/queue.interface.js";
import { Mediator } from "../../cqrs/Mediator.js";
import {
  FASTIFY_KIT_METADATA_SYMBOL,
  FastifyKitOptions,
} from "../FastifyKit.js";

/**
 * @description Método privado para inicializar el motor de CQRS (Mediator).
 * Registra el Mediator globalmente para que pueda ser inyectado en cualquier controlador.
 */
export async function initializeCqrsModule(
  allProviders: { token: any; implementation: Constructor }[],
) {
  // Si no está registrado en el contenedor, lo registramos
  if (!container.has(Mediator)) {
    container.registerClass(Mediator, Mediator);
  }

  // Lo añadimos al array de proveedores globales para que tenga acceso a los
  // lifecycle hooks (ej: onModuleInit) en caso de que el Mediator los necesite a futuro idk.
  if (!allProviders.some((p) => p.token === Mediator)) {
    allProviders.push({
      token: Mediator,
      implementation: Mediator,
    });
  }
}

/**
 * @description Método privado para inicializar el módulo de WebRTC integrado en FastifyKit.
 * @param options Las opciones de configuración para FastifyKit, que incluyen la configuración de WebRTC
 * en la propiedad "webrtc". Si esta propiedad está presente, se inicializará el módulo de WebRTC.
 * @param allProviders El array de proveedores registrados en los módulos
 */
export async function initializeWebRtcModule(
  options: FastifyKitOptions,
  allProviders: { token: any; implementation: Constructor }[],
) {
  if (options.webrtc) {
    // Forzamos la activación del plugin de WebSockets si el usuario ha activado la opción de WebRTC,
    // ya que el módulo de WebRTC depende de los gateways de WebSocket para funcionar correctamente.
    options.websockets ||= true;

    const webrtcConfig =
      typeof options.webrtc === "object" ? options.webrtc : {};

    // Guardamos la configuración de WebRTC en el ConfigService inyectable
    const configService = container.resolve<ConfigService>(CONFIG_SERVICE_TOKEN);
    configService.set("webrtc", webrtcConfig);

    const { SFU_ROOM_MANAGER_TOKEN } =
      await import("../../webrtc/interfaces/SfuRoomManager.js");
    const { AdvancedSfuRoomManager } =
      await import("../../webrtc/managers/AdvancedSfuRoomManager.js");

    // Si el usuario no ha registrado un Manager para las salas de SFU,
    // registramos el Manager por defecto para WebRTC (AdvancedSfuRoomManager)
    if (!container.has(SFU_ROOM_MANAGER_TOKEN)) {
      // Registramos el Manager por defecto para WebRTC
      container.registerClass(SFU_ROOM_MANAGER_TOKEN, AdvancedSfuRoomManager);

      // Registramos el Manager por defecto para WebRTC como un provider normal
      // para que pueda ser inyectado en cualquier parte de la aplicación utilizando su token de inyección de dependencias.
      if (!allProviders.some((p) => p.token === SFU_ROOM_MANAGER_TOKEN)) {
        allProviders.push({
          token: SFU_ROOM_MANAGER_TOKEN,
          implementation: AdvancedSfuRoomManager,
        });
      }
    }

    // Si el usuario ha activado la opción de useDefaultGateway,
    // inyectamos automáticamente el DefaultWebRtcGateway en el contenedor
    // de inyección de dependencias y lo registramos como un WebSocket Gateway
    // para que el usuario pueda usarlo sin tener que definirlo ni registrarlo manualmente.
    if (webrtcConfig.useDefaultGateway) {
      // Usamos importación dinámica (Lazy Load) para no cargar Mediasoup si WebRTC está apagado
      const { DefaultWebRtcGateway } =
        await import("../../webrtc/gateways/DefaultWebRtcGateway.js");

      // Lo registramos en el DI Container
      container.registerClass(DefaultWebRtcGateway, DefaultWebRtcGateway);

      // Registramos el Gateway por defecto para WebRTC
      // como un WebSocket Gateway utilizando su token de inyección de dependencias.
      if (!allProviders.some((p) => p.token === DefaultWebRtcGateway)) {
        allProviders.push({
          token: DefaultWebRtcGateway,
          implementation: DefaultWebRtcGateway,
        });
      }
    }
  }
}

/**
 * @description Método privado para inicializar el módulo de colas (BackgroundJobs) integrado en FastifyKit.
 * @param options Las opciones de configuración para FastifyKit, que incluyen la configuración del motor
 * de colas en la propiedad "queue". Si esta propiedad está presente, se inicializará el módulo de colas.
 * @param allControllers El array de controladores registrados en los módulos
 * @param allProviders El array de proveedores registrados en los módulos
 */
export async function initializeQueueModule(
  options: FastifyKitOptions,
  allControllers: Constructor[],
  allProviders: { token: any; implementation: Constructor }[],
) {
  // Guardamos la configuración del motor de BackgroundJobs en el ConfigService inyectable
  const queueConfig: QueueOptions = options.queue || {
    strategy: "in-process",
  };

  // Guardamos la configuración de colas en el ConfigService
  const configService = container.resolve<ConfigService>(CONFIG_SERVICE_TOKEN);
  configService.set("queue", queueConfig);

  if (!options.queue) return;

  // Lazy-loading para no cargar nada relacionado con colas si el usuario no ha configurado la opción de queue
  const { QueueRegistry } = await import("../../queues/QueueRegistry.js");
  const { QueueManager } = await import("../../queues/QueueManager.js");

  // Importamos el token de forma dinámica para mantener el lazy loading
  const adapterInterfaces =
    await import("../../queues/interfaces/QueueAdapter.js");
  const ADAPTER_TOKEN = adapterInterfaces.QUEUE_ADAPTER_TOKEN;
  // Invocamos la Factory para resolver el Adaptador (In-Process, WorkerPool o Redis) según la configuración del usuario.
  // Esto registra automáticamente el QUEUE_ADAPTER_TOKEN en el contenedor (En caso de no tener una impl custom)
  await registerQueueAdapter(ADAPTER_TOKEN, allProviders);

  // Registramos el QueueManager en el contenedor para que sea inyectable
  await registerQueueManager(QueueManager, allProviders);

  // Registrar configuración específica según la estrategia
  await registerQueueStrategySpecificServices(
    options,
    queueConfig,
    allProviders,
  );

  // Escaneamos para buscar todos los Procesadores
  await registerQueueProcessors(allControllers, allProviders, QueueRegistry);
}

/**
 * @description Método privado para inicializar el módulo distribuido de FastifyKit.
 */
export async function initializeDistributedModule(
  options: FastifyKitOptions,
  allProviders: { token: any; implementation: Constructor }[],
) {
  const distributed = options.distributed;
  if (!distributed?.redis) return;

  // Registramos la conexión centralizada de Redis
  const { registerRedisConnection, RedisConnectionManager } =
    await import("../../distributed/redis.factory.js");
  registerRedisConnection();

  // Registramos el gestor de cierre de conexión para el ciclo de vida
  registerProvider(RedisConnectionManager, allProviders);

  if (distributed.features?.eventBus) {
    try {
      await registerRedisEventBus(allProviders);
    } catch (error) {
      console.error(error);
      console.error(
        "[FastifyKit Boot Error] Has configurado distributed.features.eventBus, pero faltan dependencias.",
      );
      console.error(
        "Para usar esta característica avanzada, por favor instala 'ioredis':",
      );
      console.error("\nnpm install ioredis\n");
      process.exit(1);
    }
  }
}

/**
 * @description Registra el adaptador de colas en el contenedor y en la lista de proveedores.
 */
export async function registerQueueAdapter(
  ADAPTER_TOKEN: symbol | string,
  allProviders: { token: any; implementation: Constructor }[],
): Promise<void> {
  const { getQueueAdapter } = await import("../../queues/queue.factory.js");
  const adapter_instance = await getQueueAdapter();

  if (!allProviders.some((p) => p.token === ADAPTER_TOKEN)) {
    allProviders.push({
      token: ADAPTER_TOKEN,
      implementation: adapter_instance.constructor as Constructor,
    });
  }
}

/**
 * @description Registra el QueueManager en el contenedor y en la lista de proveedores.
 */
export async function registerQueueManager(
  QueueManager: Constructor,
  allProviders: { token: any; implementation: Constructor }[],
): Promise<void> {
  container.registerClass(QueueManager, QueueManager);

  // Lo añadimos a la lista de providers para asegurar su ciclo de vida
  if (!allProviders.some((p) => p.token === QueueManager)) {
    allProviders.push({
      token: QueueManager,
      implementation: QueueManager,
    });
  }
}

/**
 * @description Registra los servicios específicos según la estrategia de colas configurada.
 */
export async function registerQueueStrategySpecificServices(
  options: FastifyKitOptions,
  queueConfig: QueueOptions,
  allProviders: { token: any; implementation: Constructor }[],
): Promise<void> {
  if (queueConfig.strategy === "worker-pool") {
    await registerWorkerPoolStrategy(allProviders);
  } else if (queueConfig.strategy === "redis") {
    const { registerRedisConnection, RedisConnectionManager } =
      await import("../../distributed/redis.factory.js");
    registerRedisConnection();
    registerProvider(RedisConnectionManager, allProviders);
    await registerRedisStrategy(options, allProviders);
  }
}

/**
 * @description Registra los servicios necesarios para la estrategia worker-pool.
 */
export async function registerWorkerPoolStrategy(
  allProviders: { token: any; implementation: Constructor }[],
): Promise<void> {
  const { WorkerPool } = await import("../../queues/workers/WorkerPool.js");

  registerProvider(WorkerPool, allProviders);
}

/**
 * @description Registra los servicios necesarios para la estrategia redis.
 */
export async function registerRedisStrategy(
  options: FastifyKitOptions,
  allProviders: { token: any; implementation: Constructor }[],
): Promise<void> {
  if (!options.distributed?.features?.eventBus) {
    console.error(
      "\n❌ [FastifyKit Boot Error] Has activado la estrategia de colas 'redis', la cual requiere comunicación entre servidores para reportar los resultados de las tareas.",
    );
    console.error(
      "Solución: Debes habilitar explícitamente el EventBus distribuido en tu configuración:",
    );
    console.error("distributed: { features: { eventBus: true } }\n");
    process.exit(1);
  }

  try {
    const { QueueWorkerManager } =
      await import("../../queues/QueueWorkerManager.js");

    registerProvider(QueueWorkerManager, allProviders);

    const { WorkerPool } = await import("../../queues/workers/WorkerPool.js");
    registerProvider(WorkerPool, allProviders);
  } catch (error) {
    console.error(error);
    console.error(
      "[FastifyKit Boot Error] Has activado la estrategia de colas 'redis', pero faltan dependencias.",
    );
    console.error(
      "Para usar esta característica avanzada, por favor instala 'bullmq' e 'ioredis':",
    );
    console.error("\nnpm install bullmq ioredis\n");
    process.exit(1);
  }
}

/**
 * @description Registra el RedisEventBus en el contenedor y en la lista de proveedores.
 */
export async function registerRedisEventBus(
  allProviders: { token: any; implementation: Constructor }[],
): Promise<void> {
  const { RedisEventBus } = await import("../../events/RedisEventBus.js");
  const { EVENT_BUS_TOKEN } = await import("../../events/EventBus.js");

  if (!container.has(EVENT_BUS_TOKEN)) {
    container.registerClass(EVENT_BUS_TOKEN, RedisEventBus);
  }

  if (!container.has(RedisEventBus)) {
    container.registerFactory(RedisEventBus, (c) => c.resolve(EVENT_BUS_TOKEN));
  }

  if (!allProviders.some((p) => p.token === EVENT_BUS_TOKEN)) {
    allProviders.push({
      token: EVENT_BUS_TOKEN,
      implementation: RedisEventBus,
    });
  }
}

/**
 * @description Registra un proveedor en el contenedor y en la lista de proveedores.
 */
export function registerProvider(
  ProviderClass: Constructor,
  allProviders: { token: any; implementation: Constructor }[],
): void {
  if (!container.has(ProviderClass)) {
    container.registerClass(ProviderClass, ProviderClass);
  }

  if (!allProviders.some((p) => p.token === ProviderClass)) {
    allProviders.push({
      token: ProviderClass,
      implementation: ProviderClass,
    });
  }
}

/**
 * @description Escanea y registra todos los procesadores de colas encontrados.
 */
export async function registerQueueProcessors(
  allControllers: Constructor[],
  allProviders: { token: any; implementation: Constructor }[],
  QueueRegistry: any,
): Promise<void> {
  const allClasses = [
    ...allControllers,
    ...allProviders.map((p) => p.implementation),
  ];

  const processors = allClasses.filter((Class) => {
    const metadata = (Class as any)[
      FASTIFY_KIT_METADATA_SYMBOL
    ] as FastifyKitMetadata;
    return !!metadata?.queue;
  });

  // Registramos los Procesadores encontrados en el QueueRegistry
  for (const ProcessorClass of processors) {
    const metadata = (ProcessorClass as any)[
      FASTIFY_KIT_METADATA_SYMBOL
    ] as FastifyKitMetadata;
    const queueMeta = metadata.queue!;

    // Registramos en la memoria estática para que el Adaptador sepa qué clase instanciar
    QueueRegistry.register(queueMeta.name, ProcessorClass, queueMeta.type);

    // Nos aseguramos de que la clase esté registrada en el DI Container
    if (!container.has(ProcessorClass)) {
      container.registerClass(ProcessorClass, ProcessorClass);
    }
  }
}
