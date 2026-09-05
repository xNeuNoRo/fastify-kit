import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Constructor } from "../../http/routing/scanner/index.js";
import type { FastifyKitOptions } from "../FastifyKit.js";
import { container } from "../../container/DIContainer.js";
import { APPLICATION_CONTEXT_TOKEN } from "../application-context.js";

/**
 * @description Contexto compartido entre todos los pasos del pipeline de bootstrap.
 * Acumula el estado que se va construyendo a medida que cada paso se ejecuta.
 */
export interface BootstrapContext {
  /** Opciones de configuración originales pasadas por el usuario a FastifyKit.create() */
  options: FastifyKitOptions;
  /** Instancia de Fastify creada durante el bootstrap */
  app: FastifyInstance<any, any, any, any, TypeBoxTypeProvider>;
  /** Todos los controladores descubiertos en el árbol de módulos */
  allControllers: Constructor[];
  /** Todos los proveedores descubiertos en el árbol de módulos */
  allProviders: { token: any; implementation: Constructor }[];
  /** Instancias que implementan hooks de ciclo de vida */
  lifecycleInstances: Set<object>;
  /** Señal de sistema recibida (SIGTERM/SIGINT) para propagar a los hooks de shutdown */
  receivedSignal?: string;
  /** Contexto anterior restaurado si el bootstrap falla antes de tomar ownership. */
  previousApplicationContext?: object;
  /** Indica que este pipeline registró el contexto global de aplicación. */
  applicationContextClaimed?: boolean;
}

/**
 * @description Interfaz para un paso individual del pipeline de bootstrap.
 * Cada paso recibe el contexto compartido y puede leerlo/modificarlo.
 */
export interface BootstrapStep {
  /** Nombre descriptivo del paso para logging y debugging */
  readonly name: string;
  /**
   * @description Ejecuta la lógica de este paso.
   * @param ctx Contexto compartido del pipeline que acumula todo el estado del bootstrap.
   */
  execute(ctx: BootstrapContext): Promise<void>;
}

/**
 * @description Orquestador del pipeline de bootstrap de FastifyKit.
 * Encadena múltiples BootstrapStep en orden y los ejecuta secuencialmente,
 * compartiendo un BootstrapContext entre todos ellos.
 *
 * Esto reemplaza el antiguo método monolítico FastifyKit.create() de 130+ líneas
 * con una arquitectura componible, testeable y extensible.
 *
 * @example
 * const app = await new BootstrapPipeline(options)
 *   .add(new PreFlightStep())
 *   .add(new FastifyInstanceStep())
 *   .add(new ModuleDiscoveryStep())
 *   .add(new CorePluginsStep())
 *   .add(new LifecycleAndRoutesStep())
 *   .add(new BootstrapHooksStep())
 *   .add(new GracefulShutdownStep())
 *   .run();
 */
export class BootstrapPipeline {
  private readonly steps: BootstrapStep[] = [];
  private readonly ctx: BootstrapContext;

  constructor(options: FastifyKitOptions) {
    this.ctx = {
      options,
      // Estos se inicializarán durante la ejecución de los pasos
      app: undefined as any,
      allControllers: [],
      allProviders: [],
      lifecycleInstances: new Set(),
    };
  }

  /**
   * @description Agrega un paso al pipeline. Los pasos se ejecutan en el orden en que se agregan.
   * @param step El paso a agregar al pipeline.
   * @returns this para encadenamiento fluido (fluent API).
   */
  add(step: BootstrapStep): this {
    this.steps.push(step);
    return this;
  }

  /**
   * @description Ejecuta todos los pasos del pipeline en orden secuencial.
   * Cada paso recibe el mismo contexto compartido y puede leerlo/modificarlo.
   * @returns La instancia de Fastify completamente configurada y lista para escuchar peticiones.
   */
  async run(): Promise<
    FastifyInstance<any, any, any, any, TypeBoxTypeProvider>
  > {
    try {
      for (const step of this.steps) {
        await step.execute(this.ctx);
      }
      return this.ctx.app;
    } catch (error) {
      await this.rollbackFailedBootstrap();
      throw error;
    }
  }

  private async rollbackFailedBootstrap(): Promise<void> {
    const app = this.ctx.app;
    if (app) {
      try {
        await app.close();
      } catch {
        // Conservamos el error del bootstrap; la limpieza es de mejor esfuerzo aquí.
      }
    }

    if (
      !this.ctx.applicationContextClaimed ||
      !container.has(APPLICATION_CONTEXT_TOKEN) ||
      container.resolve(APPLICATION_CONTEXT_TOKEN) !== app
    ) {
      return;
    }

    if (this.ctx.previousApplicationContext) {
      container.registerInstance(
        APPLICATION_CONTEXT_TOKEN,
        this.ctx.previousApplicationContext,
      );
    } else {
      container.unregister(APPLICATION_CONTEXT_TOKEN);
    }
  }
}
