import { container } from "../container/DIContainer.js";
import { requestContext } from "../http/context/requestContext.js";
import { getLogger } from "../logger/logger.factory.js";

/**
 * @description Este módulo proporciona herramientas para manejar transacciones en la base de datos de manera transparente y eficiente. Incluye un decorador @Transactional para ejecutar métodos dentro de una transacción, un token simbólico para registrar el TransactionManager en el contenedor de dependencias, y una función para crear un Proxy que intercepta las llamadas a la base de datos y redirige
 */

/**
 * @description Token simbólico que se utiliza para registrar y resolver la implementación del TransactionManager en el contenedor de dependencias de FastifyKit.
 */
export const TRANSACTION_MANAGER_TOKEN = Symbol("TRANSACTION_MANAGER");

/**
 * @description Interfaz que define el contrato para un TransactionManager. Cualquier clase que implemente esta interfaz debe proporcionar una implementación del método runInTransaction, que se encargará de ejecutar una función dentro de una transacción. El TransactionManager es responsable de manejar la lógica de inicio, confirmación y rollback de transacciones, así como de almacenar la instancia de la transacción en el contexto de ejecución actual (ALS) para que pueda ser utilizada por el Proxy de la base de datos y otros componentes que necesiten acceder a la transacción activa.
 * @example
 * ```typescript
 * class PrismaTransactionManager implements ITransactionManager {
 *   constructor(private prisma: PrismaClient) {}
 *
 *   async runInTransaction<T>(action: () => Promise<T>): Promise<T> {
 *     return await this.prisma.$transaction(async (tx) => {
 *       // Aquí podrías almacenar la transacción en el contexto de ejecución (ALS) si es necesario
 *       return await action();
 *     });
 *   }
 * }
 * ```
 */
export interface ITransactionManager {
  runInTransaction<T>(action: () => Promise<T>): Promise<T>;
}

/**
 * @description Función auxiliar que se encarga de ejecutar una función dentro de una transacción proporcionada por un TransactionManager. Esta función crea un nuevo contexto de ejecución (ALS) para la transacción, asegurándose de que cualquier llamada a través del Proxy de la base de datos dentro de la función action se beneficie automáticamente de la transacción activa. Esto es especialmente útil para evitar problemas con transacciones anidadas y para garantizar que la transacción se propague correctamente a lo largo de toda la cadena de llamadas.
 * @param txManager Instancia del TransactionManager que se utilizará para ejecutar la función dentro de una transacción. Este TransactionManager debe haber sido registrado previamente en el contenedor de dependencias de FastifyKit para que pueda ser resuelto y utilizado en el decorador \@Transactional.
 * @param action Función asíncrona que contiene la lógica que se desea ejecutar dentro de la transacción. Cualquier llamada a través del Proxy de la base de datos dentro de esta función se beneficiará automáticamente de la transacción activa, lo que permite que los métodos decorados con \@Transactional puedan llamar a otros métodos también decorados sin problemas, propagando la misma transacción a lo largo de toda la cadena de llamadas.
 * @returns El resultado de la función action ejecutada dentro de la transacción.
 */
async function executeInIsolatedTransaction<T>(
  txManager: ITransactionManager,
  action: () => Promise<T>,
): Promise<T> {
  // Creamos un nuevo contexto de ejecución, copiando el store del contexto padre
  // para no perder ningún dato que ya esté almacenado, pero marcándolo como una transacción
  // activa para que el Proxy de la base de datos sepa que debe redirigir las llamadas a la
  // instancia de transacción activa en lugar de a la conexión principal.
  const parentStore = requestContext.getStore();
  const childStore = new Map(parentStore || []);
  childStore.set("is_transaction_active", true);
  return await requestContext.run(childStore, () =>
    txManager.runInTransaction(action),
  );
}

/**
 * @description Decorador de método para ejecutar el método decorado dentro de una transacción proporcionada por un TransactionManager. Este decorador se asegura de que si ya hay una transacción activa en el contexto de ejecución actual, el método decorado se ejecute dentro de esa misma transacción en lugar de crear una nueva. Esto permite que los métodos decorados con @Transactional puedan llamar a otros métodos también decorados sin problemas, propagando la misma transacción a lo largo de toda la cadena de llamadas.
 * @returns Una función que envuelve el método original, ejecutándolo dentro de una transacción proporcionada por el TransactionManager. Si ya hay una transacción activa, simplemente ejecuta el método sin crear una nueva transacción.
 * @example
 * ```typescript
 * class UserService {
 *   \@Transactional()
 *   async createUser(data: { name: string; email: string }) {
 *     // Lógica para crear un usuario en la base de datos
 *     // Cualquier llamada a través del proxy de la base de datos dentro de este método se beneficiará automáticamente de la transacción.
 *   }
 * }
 * ```
 * @remarks Para que este decorador funcione correctamente, es necesario que se haya registrado una implementación de ITransactionManager en el contenedor de dependencias de FastifyKit. Si no se ha registrado ningún TransactionManager, el decorador lanzará un error informando al desarrollador que debe proporcionar uno en sus módulos. Además, este decorador está diseñado para funcionar en conjunto con el Proxy de la base de datos que se encarga de redirigir las llamadas a la instancia de transacción activa, lo que permite que cualquier componente que utilice el cliente de base de datos pueda beneficiarse automáticamente de las transacciones sin necesidad de código adicional.
 * @see createTransactionProxy para más detalles sobre cómo funciona el Proxy de la base de datos en conjunto con este decorador.
 */
export function Transactional() {
  return function <This, Args extends any[], Return>(
    target: (this: This, ...args: Args) => Promise<Return>,
    _context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Promise<Return>
    >,
  ) {
    return async function (this: This, ...args: Args): Promise<Return> {
      // Resolvemos el TransactionManager del contenedor de dependencias para poder usarlo en este decorador.
      const txManager = container.resolve<ITransactionManager>(
        TRANSACTION_MANAGER_TOKEN,
      );

      // Si no se ha registrado un TransactionManager, lanzamos un error para informar
      // al desarrollador que debe proporcionar uno en su módulo.
      if (!txManager) {
        throw new Error(
          "[FastifyKit] No se ha registrado un ITransactionManager. Asegúrate de proveer uno en tus módulos.",
        );
      }

      // Obtenemos el store del contexto de ejecución actual para verificar si ya hay una transacción activa en este hilo.
      const store = requestContext.getStore();
      const action = () => target.apply(this, args);

      // Si ya hay una transacción activa en este contexto,
      // simplemente ejecutamos el método sin crear una nueva transacción.
      // Esto permite que los métodos decorados con @Transactional puedan llamar a otros métodos también decorados sin problemas.
      // Osea, si ya estamos dentro de una transacción, se propagara automáticamente a otros métodos que se llamen también decorados, evitando la creación de transacciones anidadas innecesarias.
      if (store?.has("is_transaction_active")) {
        return await action();
      }

      // Intentamos ejecutar el método dentro de una transacción proporcionada por el TransactionManager.
      try {
        return await executeInIsolatedTransaction(txManager, action);
      } catch (error) {
        getLogger().error(
          "[FastifyKit] Error al ejecutar método dentro de transacción:",
          { error },
        );
        // Re-lanzamos para que el controlador o el filtro de excepciones lo capturen
        throw error;
      }
    };
  };
}
