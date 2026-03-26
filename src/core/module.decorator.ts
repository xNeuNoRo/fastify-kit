import type { Constructor } from "../http/routing/scanner.js";
import type { ModuleOptions, FastifyKitMetadata } from "../http/decorators/types.js";

/**
 * @description Decorador para definir un módulo en FastifyKit.
 * Permite organizar controladores, proveedores y dependencias en unidades lógicas.
 * @param options Opciones para configurar el módulo, como controladores, proveedores, módulos importados, etc.
 * @example
 * \@Module({
 *   controllers: [UserController],
 *   providers: [UserService],
 *   imports: [DatabaseModule],
 *   exports: [UserService],
 * })
 * class UserModule {
 *   // Aquí puedes definir lógica específica del módulo, aunque generalmente se recomienda mantener los módulos como contenedores de organización y dejar la lógica a los servicios y controladores.
 *   // Si necesitas ejecutar código al inicializar el módulo, considera usar un Lifecycle Hook como onModuleInit() en lugar de poner lógica directamente en el constructor.
 *   constructor() {
 *     // Evita poner lógica compleja aquí. El constructor debe ser lo más simple posible para no interferir con el proceso de inyección de dependencias.
 *   }
 * }
 * @remarks El decorador @Module es fundamental para la organización de la aplicación en FastifyKit, ya que permite agrupar controladores, servicios y otros proveedores relacionados en módulos cohesivos. Esto facilita la mantenibilidad y escalabilidad de la aplicación, permitiendo que cada módulo tenga una responsabilidad clara y pueda ser desarrollado y probado de manera independiente. Además, el sistema de módulos de FastifyKit está diseñado para trabajar en conjunto con el contenedor de dependencias, lo que permite resolver fácilmente las dependencias entre módulos y compartir servicios a través de la opción "exports".
 */
export function Module(options: ModuleOptions) {
  return function <T extends Constructor>(
    _target: T,
    context: ClassDecoratorContext<T>,
  ) {
    if (context.kind !== "class") {
      throw new Error("@Module solo puede aplicarse a clases.");
    }

    // Casteamos el metadata compartido al tipo FastifyKitMetadata
    const metadata = context.metadata as FastifyKitMetadata;

    // Almacenamos las opciones. Esto permitirá que la Factory escanee el árbol de forma recursiva.
    metadata.moduleOptions = options;
  };
}
