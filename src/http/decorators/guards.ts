import type { CanActivate } from "../guards/CanActivate.js";
import type { Constructor } from "../routing/scanner/index.js";

/**
 * @description Decorador para aplicar guards a clases o métodos en FastifyKit. Permite registrar uno o varios guards que se ejecutarán antes de acceder a la ruta protegida, ya sea a nivel de clase (aplicando los guards a todas las rutas del controlador) o a nivel de método (aplicando los guards solo a la ruta específica). Este decorador es fundamental para implementar mecanismos de autorización y control de acceso en la aplicación, asegurando que solo los usuarios o roles autorizados puedan acceder a ciertas funcionalidades o recursos.
 * @param guards Uno o varios guards que implementan la interfaz CanActivate. Estos guards serán evaluados antes de permitir el acceso a la ruta protegida, y deben retornar true para permitir el acceso o false para denegarlo. Los guards pueden realizar cualquier lógica de validación necesaria, como verificar tokens de autenticación, roles de usuario, permisos específicos, etc.
 * @returns Una función que envuelve la definición de la clase o método, registrando los guards en el metadata correspondiente para su uso posterior durante la ejecución de las rutas.
 * @example
 * ```typescript
 * \@Controller("/admin")
 * \@UseGuards(AdminGuard) // Aplica el guard a todas las rutas del controlador
 * class AdminController {
 *   \@Get("/dashboard")
 *   \@UseGuards(DashboardGuard) // Aplica un guard adicional solo a esta ruta
 *   getDashboard() {
 *     // Lógica para manejar la solicitud GET /admin/dashboard
 *   }
 * }
 * ```
 * @remarks Al aplicar \@UseGuards a una clase, los guards registrados se aplicarán a todas las rutas definidas dentro de esa clase. Si se aplica a un método, los guards solo se aplicarán a esa ruta específica. Es importante tener en cuenta que si se aplican guards tanto a nivel de clase como a nivel de método, ambos conjuntos de guards serán evaluados, y el acceso solo se permitirá si todos los guards retornan true. Este decorador es una herramienta poderosa para implementar la seguridad y el control de acceso en la aplicación, y se integra perfectamente con el sistema de routing y ejecución de FastifyKit para garantizar que las rutas protegidas solo sean accesibles para los usuarios autorizados.
 * @see CanActivate para más detalles sobre cómo implementar guards personalizados.
 */
export function UseGuards(...guards: Constructor<CanActivate>[]) {
  return function (
    _target: Function,
    context: ClassDecoratorContext | ClassMethodDecoratorContext,
  ) {
    // Si no hay metadata en el contexto, no hacemos nada
    if (!context.metadata) return;

    // Si el decorador se aplica a una clase, registramos los guards en el metadata de la clase
    if (context.kind === "class") {
      context.metadata.classGuards = [
        ...((context.metadata.classGuards as Constructor<CanActivate>[]) || []),
        ...guards,
      ];
    }
    // Si el decorador se aplica a un método, registramos los guards en el metadata del método
    else if (context.kind === "method") {
      // Nombre del método al que se le aplicó el decorador
      const handlerName = context.name;

      // Inicializamos el mapa de guards por ruta si no existe
      context.metadata.routeGuards ??= {};
      const routeGuardsMap = context.metadata.routeGuards as Record<
        string | symbol,
        Constructor<CanActivate>[]
      >;

      // Guardamos los guards en el map de guards por el nombre del método
      routeGuardsMap[handlerName] = [
        ...(routeGuardsMap[handlerName] || []),
        ...guards,
      ];
    }
    // Si el decorador se aplica a algo que no es clase ni método, lanzamos un error indicando que @UseGuards solo puede aplicarse a clases o métodos
    else {
      throw new Error(
        `[FastifyKit] @UseGuards solo puede aplicarse a clases o métodos.`,
      );
    }
  };
}
