import { requestContext } from "../http/context/requestContext";

/**
 * @description Este modulo crea un Proxy que intercepta todas las llamadas a la base de datos.
 * Si hay una transacción activa en el ALS, la usa. Si no, usa el cliente global.
 */

/**
 * @description Función para crear un Proxy que intercepta las llamadas a la base de datos y redirige a la instancia de transacción activa si existe. Este Proxy permite que cualquier componente que utilice el cliente de base de datos pueda beneficiarse automáticamente de las transacciones sin necesidad de modificar su código para inyectar o pasar explícitamente la instancia de la transacción.
 * @param globalInstance La instancia global del cliente de base de datos (por ejemplo, el Prisma Client) que se utiliza cuando no hay una transacción activa. Esta instancia se usará como fallback cuando no se detecte una transacción en el contexto actual.
 * @param alsKey El nombre de la clave que se utiliza en el Almacén de Contexto Asíncrono (ALS) para almacenar la instancia de la transacción. Por defecto, se asume que el TransactionManager almacena la transacción bajo la clave "prisma_tx", pero este valor puede ser personalizado si se utiliza un TransactionManager diferente que use una clave distinta.
 * @example
 * ```typescript
 * // Supongamos que tenemos un Prisma Client global llamado "prisma"
 * const prisma = new PrismaClient();
 *
 * // Creando un proxy que intercepta las llamadas a la base de datos
 * const prismaProxy = createTransactionProxy(prisma);
 *
 * // Ahora, en cualquier parte de la aplicación, podemos usar "prismaProxy" en lugar de "prisma"
 * // y automáticamente se usará la transacción activa si existe, o el cliente global si no.
 * async function createUser(data: { name: string; email: string }) {
 *   // Esta llamada usará la transacción activa si existe, o el cliente global si no
 *   return await prismaProxy.user.create({ data });
 * }
 *
 * // Esta diseñado para combinarse con el decorador \@Transactional, que se encarga de iniciar la transacción y almacenarla en el ALS, por lo que cualquier llamada a través del proxy dentro de un método decorado con \@Transactional se beneficiará automáticamente de la transacción sin necesidad de código adicional.
 * \@Transactional()
 * async function createUserWithTransaction(data: { name: string; email: string }) {
 *   // Dentro de este método, cualquier llamada a través de "prisma
 * }
 * ```
 * @returns El proxy que intercepta las llamadas a la base de datos.
 */
export function createTransactionProxy<T extends object>(
  globalInstance: T,
  alsKey: string = "prisma_tx", // El nombre que usamos en el TransactionManager
): T {
  return new Proxy(globalInstance, {
    get(target, prop, receiver) {
      // Miramos si hay una transacción en el almacén actual (ALS)
      const store = requestContext.getStore();
      const tx = store?.get(alsKey);

      // Elegimos el objetivo: la transacción (si existe) o el cliente global
      const activeInstance = tx || target;

      // Reflect.get nos permite obtener la propiedad de forma segura,
      // respetando el contexto de "this" y otras características de los objetos en JavaScript.
      // Si la propiedad es una función, la vinculamos al objeto activo para preservar el contexto de "this".
      const value: unknown = Reflect.get(activeInstance, prop, receiver);

      // Si la propiedad es una función,
      // la vinculamos al objeto activo para preservar el contexto de "this"
      // Si no hacemos esto, podríamos perder el contexto correcto de "this"
      // al llamar a métodos que dependen de él (como los modelos de Prisma que necesitan acceder a
      // la instancia de la transacción a través de "this").
      if (typeof value === "function") {
        return value.bind(activeInstance);
      }

      // Para propiedades que no son funciones, simplemente las retornamos.
      // (Como los modelos de Prisma que se acceden como propiedades, por ejemplo "client.user" o "client.post")
      return value;
    },
  });
}
