import { container } from "../../container/DIContainer";
import { FastifyKitMetadata } from "./types";

/**
 * @description Decorador de clase para marcar una clase como un controlador en el contexto de una aplicación web. Este decorador permite definir un prefijo de ruta para todas las rutas definidas dentro de la clase, lo que facilita la organización y estructuración de los endpoints de la API. Además, al aplicar este decorador, la clase se registra automáticamente en el contenedor de inyección de dependencias de FastifyKit, lo que permite que sus instancias sean resueltas y utilizadas en otras partes de la aplicación, como en los servicios o en otros controladores.
 * @param prefix Un string opcional que define el prefijo de ruta para todas las rutas dentro de este controlador. Por ejemplo, si se establece el prefijo como "/users", y dentro de la clase se define una ruta con el path "/profile", la ruta completa para acceder a ese endpoint sería "/users/profile". Si no se proporciona un prefijo, las rutas definidas en la clase se registrarán sin ningún prefijo adicional.
 * @returns Una función que envuelve la definición de la clase, registrándola como un controlador en el contenedor de inyección de dependencias de FastifyKit y almacenando el prefijo de ruta en la metadata de la clase para su uso posterior en la configuración de las rutas.
 * @example
 * ```typescript
 * \@Controller("/users")
 * class UserController {
 *   \@Get("/profile")
 *   getUserProfile() {
 *     // Lógica para manejar la solicitud GET /users/profile
 *   }
 * }
 * ```
 * @remarks El decorador \@Controller es fundamental para la organización de los endpoints en una aplicación web, ya que permite agrupar rutas relacionadas bajo un mismo prefijo, lo que mejora la legibilidad y mantenibilidad del código. Además, al registrar automáticamente la clase en el contenedor de inyección de dependencias, facilita la gestión de las dependencias y la integración con otros componentes de la aplicación, como servicios o middleware.
 */
export function Controller(prefix: string = "") {
  return function <T, Args extends any[]>(
    ClassDefinition: new (...args: Args) => T,
    context: ClassDecoratorContext<new (...args: Args) => T>,
  ) {
    if (context.kind !== "class") {
      throw new Error("@Controller solo puede ser aplicado a clases");
    }

    // Casteamos la metadata como FastifyKitMetadata para poder acceder a las propiedades personalizadas que hemos definido en la interfaz FastifyKitMetadata, como routes, classGuards, routeGuards, etc.
    const metadata = context.metadata as FastifyKitMetadata;

    // Usamos la nueva API de metadata de los decoradores para almacenar el prefijo en el contexto de la clase
    // Normalizamos el prefijo para evitar problemas de rutas como "/users/"
    metadata.prefix = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;

    // Registramos la clase en el contenedor de inyección de dependencias utilizando la propia clase como key
    container.registerClass(ClassDefinition, ClassDefinition);
  };
}
