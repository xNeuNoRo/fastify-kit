import type { Constructor } from "../http/routing/scanner/index.js";
import type { QueueType } from "./interfaces/queue-options.js";

interface QueueDefinition {
  processorClass: Constructor;
  type: QueueType;
}

/**
 * @description Registro global en memoria que mapea el nombre de las colas
 * con sus respectivas clases procesadoras y perfiles de ejecución (CPU o IO).
 */
export class QueueRegistry {
  private static readonly registry = new Map<string, QueueDefinition>();
  private static readonly processorFiles = new Set<string>();

  /**
   * @description Registra un nuevo procesador de cola en memoria.
   * Este método es llamado por el scanner del framework cada vez
   * que descubre una clase decorada con \@QueueProcessor.
   * @param queueName El nombre de la cola para la que se registra el procesador, debe ser único
   * @param processorClass La clase del procesador que se encargará de manejar los trabajos de la cola,
   * debe implementar la interfaz JobHandler
   * @param type El tipo de la cola, que puede ser "cpu" o "io", utilizado para determinar
   * la estrategia de asignación de workers en el pool.
   */
  public static register(
    queueName: string,
    processorClass: Constructor,
    type: QueueType,
  ): void {
    if (this.registry.has(queueName)) {
      throw new Error(
        `[FastifyKit QueueRegistry] Ya existe un procesador registrado para la cola '${queueName}'.`,
      );
    }

    this.registry.set(queueName, { processorClass, type });
  }

  /**
   * @description Obtiene la clase del procesador registrado para una cola específica.
   * @param queueName El nombre de la cola para la que se desea obtener el procesador
   * @returns La clase del procesador registrado para la cola, o undefined si no se
   * encuentra ningún procesador registrado para esa cola
   */
  public static getProcessor(queueName: string): Constructor | undefined {
    return this.registry.get(queueName)?.processorClass;
  }

  /**
   * @description Obtiene el tipo de una cola específica, utilizado para determinar la estrategia
   * @param queueName El nombre de la cola para la que se desea obtener el tipo
   * @returns El tipo de la cola ("cpu" o "io"), o undefined si no se encuentra ningún procesador registrado para esa cola
   */
  public static getQueueType(queueName: string): QueueType | undefined {
    return this.registry.get(queueName)?.type;
  }

  /**
   * @description Método de utilidad para obtener una lista de todas las colas registradas en el sistema.
   * @returns Un array con los nombres de todas las colas que tienen un procesador registrado en el sistema.
   */
  public static getRegisteredQueues(): string[] {
    return Array.from(this.registry.keys());
  }

  /**
   * @description Registra la ruta de un archivo que contiene uno o más procesadores.
   */
  public static addProcessorFile(path: string): void {
    this.processorFiles.add(path);
  }

  /**
   * @description Obtiene todas las rutas de archivos registradas.
   */
  public static getProcessorFiles(): string[] {
    return Array.from(this.processorFiles);
  }

  /**
   * @description Método de utilidad para limpiar el registro de colas y archivos de procesadores,
   * utilizado principalmente en tests para asegurar un estado limpio entre pruebas.
   */
  static clear(): void {
    this.registry.clear();
    this.processorFiles.clear();
  }
}
