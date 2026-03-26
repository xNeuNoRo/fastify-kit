import type { FastifySchema } from "fastify";
import type { HttpMethod } from "../routing/types.js";
import type { FastifyKitMetadata } from "./types.js";

function createRouteDecorator(method: HttpMethod) {
  return function (path: string = "", schema?: FastifySchema) {
    return function <This, Args extends any[], Return>(
      _target: (this: This, ...args: Args) => Return,
      context: ClassMethodDecoratorContext<
        This,
        (this: This, ...args: Args) => Return
      >,
    ) {
      // Validamos que el decorador se aplique solo a métodos de clase
      if (context.kind !== "method") {
        throw new Error(
          `[FastifyKit]  @${method} solo puede ser aplicado a métodos de una clase`,
        );
      }

      // Casteamos la metadata como FastifyKitMetadata para poder acceder a las propiedades personalizadas
      // que hemos definido en la interfaz FastifyKitMetadata, como routes, classGuards, routeGuards, etc.
      const metadata = context.metadata as FastifyKitMetadata;

      // Si no existe el array de rutas en el contexto de la clase, lo inicializamos
      // Las rutas se almacenaran aqui de esta forma:
      // context.metadata.routes = [
      //   { method: "get", path: "/users", handlerName: "getUsers", schema: {...} },
      //   { method: "post", path: "/users", handlerName: "createUser", schema: {...} },
      //   ...
      // ]
      metadata.routes ??= [];

      // Agregamos la ruta al array de rutas en el contexto de la clase
      metadata.routes.push({
        method, // El método HTTP especificado en el decorador (ej: "get", "post", etc.)
        path, // La ruta especificada en el decorador (ej: "/users")
        handlerName: context.name, // El nombre del método (ej: "getAll")
        schema, // El esquema de validación (si se proporcionó)
      });
    };
  };
}

// Creamos los decoradores específicos para cada método HTTP utilizando la función createRouteDecorator
/**
 * @description Decorador del metodo HTTP GET para definir rutas en los controladores de FastifyKit. Este decorador permite especificar la ruta y un esquema de validación opcional para las solicitudes GET, registrando esta información en la metadata del método para su uso posterior durante la configuración de las rutas en el servidor.
 * @param path La ruta específica para esta ruta GET. Por ejemplo, si se establece como "/users", esta ruta responderá a las solicitudes GET realizadas a "/users". Si no se proporciona un path, la ruta se registrará con un path vacío, lo que significa que responderá a las solicitudes GET realizadas a la raíz del prefijo definido en el controlador.
 * @param schema Un esquema de validación opcional que se utilizará para validar las solicitudes entrantes a esta ruta. Este esquema debe seguir la estructura de los esquemas de validación de Fastify, y puede incluir definiciones para los parámetros de consulta, el cuerpo de la solicitud, los encabezados, etc. Si se proporciona un esquema, Fastify lo utilizará automáticamente para validar las solicitudes antes de que lleguen al método del controlador, y devolverá errores de validación si las solicitudes no cumplen con el esquema definido.
 * @returns Una función que envuelve la definición del método, registrando la información de la ruta (método HTTP, path, handlerName y esquema) en la metadata del método para su uso posterior durante la configuración de las rutas en el servidor.
 * @example
 * ```typescript
 * \@Controller("/users")
 * class UserController {
 *   \@Get("/", {
 *     querystring: {
 *       type: "object",
 *       properties: {
 *         page: { type: "number" },
 *         limit: { type: "number" },
 *       },
 *     },
 *   })
 *   getAllUsers() {
 *     // Lógica para manejar la solicitud GET /users con validación de querystring
 *   }
 *
 * // Tambien se puede combinar con un esquema de validación de TypeBox, de hecho viene integrado con TypeBox para facilitar la validación de las solicitudes, por lo que puedes usar los esquemas de TypeBox directamente en el decorador:
 *  \@Get("/search", {
 *     querystring: Type.Object({
 *      name: Type.Optional(Type.String()),
 *      age: Type.Optional(Type.Number()), // Podrias tenerlo en un DTO y simplemente llamarlo aqui, por ejemplo: querystring: UserSearchQuerySchema
 *     }),
 *   })
 * }
 * ```
 * @remarks Este decorador es parte fundamental del sistema de routing de FastifyKit, ya que permite definir claramente las rutas y sus características directamente en los métodos del controlador, mejorando la legibilidad y mantenibilidad del código. Además, al registrar esta información en la metadata del método, facilita la configuración automática de las rutas en el servidor, ya que el framework puede leer esta metadata para configurar las rutas de manera dinámica durante la inicialización de la aplicación.
 * @see createRouteDecorator para más detalles sobre cómo se implementan estos decoradores de ruta.
 */
export const Get = createRouteDecorator("get");

/**
 * @description Decorador del metodo HTTP POST para definir rutas en los controladores de FastifyKit. Este decorador permite especificar la ruta y un esquema de validación opcional para las solicitudes POST, registrando esta información en la metadata del método para su uso posterior durante la configuración de las rutas en el servidor.
 * @param path La ruta específica para esta ruta POST. Por ejemplo, si se establece como "/users", esta ruta responderá a las solicitudes POST realizadas a "/users". Si no se proporciona un path, la ruta se registrará con un path vacío, lo que significa que responderá a las solicitudes POST realizadas a la raíz del prefijo definido en el controlador.
 * @param schema Un esquema de validación opcional que se utilizará para validar las solicitudes entrantes a esta ruta. Este esquema debe seguir la estructura de los esquemas de validación de Fastify, y puede incluir definiciones para los parámetros de consulta, el cuerpo de la solicitud, los encabezados, etc. Si se proporciona un esquema, Fastify lo utilizará automáticamente para validar las solicitudes antes de que lleguen al método del controlador, y devolverá errores de validación si las solicitudes no cumplen con el esquema definido.
 * @returns Una función que envuelve la definición del método, registrando la información de la ruta (método HTTP, path, handlerName y esquema) en la metadata del método para su uso posterior durante la configuración de las rutas en el servidor.
 * @example
 * ```typescript
 * \@Controller("/users")
 * class UserController {
 *   \@Post("/", {
 *     body: {
 *       type: "object",
 *       properties: {
 *         name: { type: "string" },
 *         email: { type: "string" },
 *       },
 *       required: ["name", "email"],
 *     },
 *   })
 *   createUser() {
 *     // Lógica para manejar la solicitud POST /users con validación del cuerpo de la solicitud
 *   }
 *
 * // Tambien se puede combinar con un esquema de validación de TypeBox, de hecho viene integrado con TypeBox para facilitar la validación de las solicitudes, por lo que puedes usar los esquemas de TypeBox directamente en el decorador:
 * \@Post("/create", {
 *     body: Type.Object({
 *     name: Type.String(),
 *    email: Type.String(), // Podrias tenerlo en un DTO y simplemente llamarlo aqui, por ejemplo: body: CreateUserRequestSchema
 *  }),
 * }
 * ```
 * @remarks Este decorador es parte fundamental del sistema de routing de FastifyKit, ya que permite definir claramente las rutas y sus características directamente en los métodos del controlador, mejorando la legibilidad y mantenibilidad del código. Además, al registrar esta información en la metadata del método, facilita la configuración automática de las rutas en el servidor, ya que el framework puede leer esta metadata para configurar las rutas de manera dinámica durante la inicialización de la aplicación.
 * @see createRouteDecorator para más detalles sobre cómo se implementan estos decoradores de ruta.
 */
export const Post = createRouteDecorator("post");

/**
 * @description Decorador del metodo HTTP PUT para definir rutas en los controladores de FastifyKit. Este decorador permite especificar la ruta y un esquema de validación opcional para las solicitudes PUT, registrando esta información en la metadata del método para su uso posterior durante la configuración de las rutas en el servidor.
 * @param path La ruta específica para esta ruta PUT. Por ejemplo, si se establece como "/users/:id", esta ruta responderá a las solicitudes PUT realizadas a "/users/123". Si no se proporciona un path, la ruta se registrará con un path vacío, lo que significa que responderá a las solicitudes PUT realizadas a la raíz del prefijo definido en el controlador.
 * @param schema Un esquema de validación opcional que se utilizará para validar las solicitudes entrantes a esta ruta. Este esquema debe seguir la estructura de los esquemas de validación de Fastify, y puede incluir definiciones para los parámetros de consulta, el cuerpo de la solicitud, los encabezados, etc. Si se proporciona un esquema, Fastify lo utilizará automáticamente para validar las solicitudes antes de que lleguen al método del controlador, y devolverá errores de validación si las solicitudes no cumplen con el esquema definido.
 * @returns Una función que envuelve la definición del método, registrando la información de la ruta (método HTTP, path, handlerName y esquema) en la metadata del método para su uso posterior durante la configuración de las rutas en el servidor.
 * @example
 * ```typescript
 * \@Controller("/users")
 * class UserController {
 *   \@Put("/:id", {
 *     body: {
 *       type: "object",
 *       properties: {
 *         name: { type: "string" },
 *         email: { type: "string" },
 *       },
 *     },
 *   })
 *   updateUser() {
 *     // Lógica para manejar la solicitud PUT /users/:id con validación del cuerpo de la solicitud
 *   }
 *
 * // Tambien se puede combinar con un esquema de validación de TypeBox, de hecho viene integrado con TypeBox para facilitar la validación de las solicitudes, por lo que puedes usar los esquemas de TypeBox directamente en el decorador:
 * \@Put("/update/:id", {
 *     body: Type.Object({
 *     name: Type.Optional(Type.String()),
 *    email: Type.Optional(Type.String()), // Podrias tenerlo en un DTO y simplemente llamarlo aqui, por ejemplo: body: UpdateUserRequestSchema
 *  }),
 * }
 * ```
 * @remarks Este decorador es parte fundamental del sistema de routing de FastifyKit, ya que permite definir claramente las rutas y sus características directamente en los métodos del controlador, mejorando la legibilidad y mantenibilidad del código. Además, al registrar esta información en la metadata del método, facilita la configuración automática de las rutas en el servidor, ya que el framework puede leer esta metadata para configurar las rutas de manera dinámica durante la inicialización de la aplicación.
 * @see createRouteDecorator para más detalles sobre cómo se implementan estos decoradores de ruta.
 */
export const Put = createRouteDecorator("put");

/**
 * @description Decorador del metodo HTTP PATCH para definir rutas en los controladores de FastifyKit. Este decorador permite especificar la ruta y un esquema de validación opcional para las solicitudes PATCH, registrando esta información en la metadata del método para su uso posterior durante la configuración de las rutas en el servidor.
 * @param path La ruta específica para esta ruta PATCH. Por ejemplo, si se establece como "/users/:id", esta ruta responderá a las solicitudes PATCH realizadas a "/users/123". Si no se proporciona un path, la ruta se registrará con un path vacío, lo que significa que responderá a las solicitudes PATCH realizadas a la raíz del prefijo definido en el controlador.
 * @param schema Un esquema de validación opcional que se utilizará para validar las solicitudes entrantes a esta ruta. Este esquema debe seguir la estructura de los esquemas de validación de Fastify, y puede incluir definiciones para los parámetros de consulta, el cuerpo de la solicitud, los encabezados, etc. Si se proporciona un esquema, Fastify lo utilizará automáticamente para validar las solicitudes antes de que lleguen al método del controlador, y devolverá errores de validación si las solicitudes no cumplen con el esquema definido.
 * @returns Una función que envuelve la definición del método, registrando la información de la ruta (método HTTP, path, handlerName y esquema) en la metadata del método para su uso posterior durante la configuración de las rutas en el servidor.
 * @example
 * ```typescript
 * \@Controller("/users")
 * class UserController {
 *   \@Patch("/:id", {
 *     body: {
 *       type: "object",
 *       properties: {
 *         name: { type: "string" },
 *         email: { type: "string" },
 *       },
 *     },
 *   })
 *   partiallyUpdateUser() {
 *     // Lógica para manejar la solicitud PATCH /users/:id con validación del cuerpo de la solicitud
 *   }
 *
 * // Tambien se puede combinar con un esquema de validación de TypeBox, de hecho viene integrado con TypeBox para facilitar la validación de las solicitudes, por lo que puedes usar los esquemas de TypeBox directamente en el decorador:
 * \@Patch("/update/:id", {
 *     body: Type.Object({
 *     name: Type.Optional(Type.String()),
 *    email: Type.Optional(Type.String()), // Podrias tenerlo en un DTO y simplemente llamarlo aqui, por ejemplo: body: UpdateUserRequestSchema
 *  }),
 * }
 * ```
 * @remarks Este decorador es parte fundamental del sistema de routing de FastifyKit, ya que permite definir claramente las rutas y sus características directamente en los métodos del controlador, mejorando la legibilidad y mantenibilidad del código. Además, al registrar esta información en la metadata del método, facilita la configuración automática de las rutas en el servidor, ya que el framework puede leer esta metadata para configurar las rutas de manera dinámica durante la inicialización de la aplicación.
 * @see createRouteDecorator para más detalles sobre cómo se implementan estos decoradores de ruta.
 */
export const Patch = createRouteDecorator("patch");

/**
 * @description Decorador del metodo HTTP DELETE para definir rutas en los controladores de FastifyKit. Este decorador permite especificar la ruta y un esquema de validación opcional para las solicitudes DELETE, registrando esta información en la metadata del método para su uso posterior durante la configuración de las rutas en el servidor.
 * @param path La ruta específica para esta ruta DELETE. Por ejemplo, si se establece como "/users/:id", esta ruta responderá a las solicitudes DELETE realizadas a "/users/123". Si no se proporciona un path, la ruta se registrará con un path vacío, lo que significa que responderá a las solicitudes DELETE realizadas a la raíz del prefijo definido en el controlador.
 * @param schema Un esquema de validación opcional que se utilizará para validar las solicitudes entrantes a esta ruta. Este esquema debe seguir la estructura de los esquemas de validación de Fastify, y puede incluir definiciones para los parámetros de consulta, el cuerpo de la solicitud, los encabezados, etc. Si se proporciona un esquema, Fastify lo utilizará automáticamente para validar las solicitudes antes de que lleguen al método del controlador, y devolverá errores de validación si las solicitudes no cumplen con el esquema definido.
 * @returns Una función que envuelve la definición del método, registrando la información de la ruta (método HTTP, path, handlerName y esquema) en la metadata del método para su uso posterior durante la configuración de las rutas en el servidor.
 * @example
 * ```typescript
 * \@Controller("/users")
 * class UserController {
 *   \@Delete("/:id", {
 *     querystring: {
 *       type: "object",
 *       properties: {
 *         softDelete: { type: "boolean" },
 *       },
 *     },
 *   })
 *   deleteUser() {
 *     // Lógica para manejar la solicitud DELETE /users/:id con validación de querystring
 *   }
 *
 * // Tambien se puede combinar con un esquema de validación de TypeBox, de hecho viene integrado con TypeBox para facilitar la validación de las solicitudes, por lo que puedes usar los esquemas de TypeBox directamente en el decorador:
 * \@Delete("/delete/:id", {
 *    querystring: Type.Object({
 *    softDelete: Type.Optional(Type.Boolean()), // Podrias tenerlo en un DTO y simplemente llamarlo aqui, por ejemplo: querystring: DeleteUserQuerySchema
 * }),
 * }
 * ```
 * @remarks Este decorador es parte fundamental del sistema de routing de FastifyKit, ya que permite definir claramente las rutas y sus características directamente en los métodos del controlador, mejorando la legibilidad y mantenibilidad del código. Además, al registrar esta información en la metadata del método, facilita la configuración automática de las rutas en el servidor, ya que el framework puede leer esta metadata para configurar las rutas de manera dinámica durante la inicialización de la aplicación.
 * @see createRouteDecorator para más detalles sobre cómo se implementan estos decoradores de ruta.
 */
export const Delete = createRouteDecorator("delete");
