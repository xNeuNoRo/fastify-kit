import { Cron } from "croner";
import type { FastifyInstance } from "fastify";
import { type Constructor } from "../../http/routing/scanner/index.js";
import { registerGateways } from "../../websockets/gateway.registry.js";
import { container } from "../../container/DIContainer.js";
import type { FastifyKitMetadata } from "../../http/decorators/types.js";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  cronContext,
  CronContext,
} from "../../scheduling/context/cronContext.js";
import { FASTIFY_KIT_METADATA_SYMBOL } from "../FastifyKit.js";

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

/**
 * @description Verifica si una clase (no instanciada) implementa al menos un hook de ciclo de vida

   * escaneando directamente su prototipo. Evita instanciaciones innecesarias (Eager Loading).
   * @param targetClass La clase a verificar, que puede ser un controlador o proveedor registrado en los módulos.
   */
export function hasLifecycleHook(targetClass: Constructor): boolean {
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
export async function executeLifecycleHook(
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
export function setupGracefulShutdown(
  app: FastifyInstance<any, any, any, any, TypeBoxTypeProvider>,
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

          // Cerramos la app. Esto disparará los hooks onClose registrados
          // en FastifyKit.ts (que ejecutan beforeApplicationShutdown y onApplicationShutdown).
          await app.close();

          // Una vez cerrada la app y ejecutados los hooks, salimos del proceso
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

    // Guardamos el handler en el map para poder removerlos si es necesario
    handlers.set(signal, handler);
    // Iniciamos el proceso de apagado llamando al handler una sola vez
    process.once(signal, handler);
  }

  // Removemos los listeners de las signals cuando la app se cierre
  // para evitar memory leaks en caso de reinicios o cierres múltiples
  app.addHook("onClose", async () => {
    for (const [signal, handler] of handlers.entries()) {
      process.removeListener(signal, handler);
    }
  });
}

/**
 * @description Método privado para configurar las tareas programadas (cron jobs) definidas en los proveedores de los módulos. Este método recorre todos los proveedores registrados, verifica si tienen tareas programadas definidas en su metadata, y si es así, instancia el proveedor (respetando el patrón Singleton) y configura un trabajo programado utilizando la expresión cron proporcionada. Además, se asegura de que cada tarea programada se ejecute dentro del contexto de solicitud adecuado para que puedan acceder a la información de la solicitud incluso cuando se ejecutan en segundo plano. Finalmente, se registra un hook para detener todos los trabajos programados cuando el servidor se detenga, evitando que sigan ejecutándose en segundo plano después de que la API haya cerrado.
 * @param app La instancia de Fastify en la que se configurarán las tareas programadas. Se utiliza para registrar los trabajos programados y el hook de cierre.
 * @param allProviders El array de proveedores registrados en los módulos, que se revisará para encontrar aquellos que tengan tareas programadas definidas en su metadata. Cada proveedor es un objeto que contiene un token y una implementación.
 */
export function setupScheduledTasks(
  app: FastifyInstance<any, any, any, any, TypeBoxTypeProvider>,
  allProviders: { token: any; implementation: Constructor }[],
): void {
  // Array para almacenar los trabajos programados y poder detenerlos cuando el servidor se detenga
  const scheduledJobs: Cron[] = [];

  for (const provider of allProviders) {
    // Leemos la metadata directamente desde la implementación
    const providerMeta = (provider.implementation as any)[
      FASTIFY_KIT_METADATA_SYMBOL
    ] as FastifyKitMetadata;

    if (providerMeta?.scheduledTasks?.length) {
      // Obligamos al contenedor a instanciar la clase AHORA (Eager Loading)
      // usando el token para respetar el Singleton
      const instance = container.resolve(provider.token);

      for (const task of providerMeta.scheduledTasks) {
        // Iniciamos el temporizador en segundo plano
        const job = new Cron(task.cronExpression, async () => {
          const store: CronContext = {
            cronId: `cron-${crypto.randomUUID()}`,
            jobName: `${provider.implementation.name}.${String(task.methodName)}`,
          };

          await cronContext.run(store, async () => {
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
 * @description Método privado para registrar los gateways de WebSocket definidos en los controladores y proveedores de los módulos. Este método recorre todos los controladores y proveedores registrados, verifica si tienen el decorador \@WebSocketGateway definido en su metadata, y si es así, los registra utilizando la función registerGateways. Esto permite que el usuario pueda definir gateways de WebSocket en cualquier controlador o proveedor de sus módulos, y la Factory se encargará de descubrirlos y registrarlos automáticamente si ha activado el soporte para WebSockets en las opciones.
 * @param app La instancia de Fastify en la que se registrarán los gateways de WebSocket. Se utiliza para llamar a la función registerGateways con los gateways encontrados en los controladores y proveedores.
 * @param allControllers El array de controladores registrados en los módulos, que se revisará para encontrar aquellos que tengan el decorador \@WebSocketGateway definido en su metadata. Cada controlador es una clase que puede tener métodos decorados como handlers de WebSocket.
 * @param allProviders El array de proveedores registrados en los módulos, que se revisará para encontrar aquellos que tengan el decorador \@WebSocketGateway definido en su metadata. Cada proveedor es un objeto que contiene un token y una implementación, y la implementación es la clase que se revisará para encontrar el decorador de WebSocket.
 */
export function registerWebSocketGateways(
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
      FASTIFY_KIT_METADATA_SYMBOL
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
