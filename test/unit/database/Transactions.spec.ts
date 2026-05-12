import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from "vitest";

import { container } from "../../../src/container/DIContainer.js";
import { transactionContext } from "../../../src/database/context/transactionContext.js";
import { createTransactionProxy } from "../../../src/database/proxy.js";
import {
  Transactional,
  TRANSACTION_MANAGER_TOKEN,
  type ITransactionManager,
} from "../../../src/database/transactions.js";

describe("Sistema de Base de Datos (Proxy & Transacciones)", () => {
  // Variable para espiar los errores del logger y verificar que se loguean correctamente en caso de excepciones dentro de transacciones
  let loggerErrorSpy: MockInstance;

  // Antes de cada test, secuestramos el método 'error' del logger (el warning es para evitar ruido del fallback de loggers)
  beforeEach(() => {
    loggerErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  // Después de cada test, restauramos los mocks para evitar interferencias entre pruebas
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Simulamos un ORM como Prisma o TypeORM
  class MockDatabaseClient {
    public isTransaction = false;

    // Un modelo de base de datos (ej. prisma.user)
    public user = {
      create: async (data: any) => {
        await Promise.resolve(); // Simulamos una operación asíncrona
        return { ...data, createdInTx: this.isTransaction };
      },
    };

    // Un método directo
    async query(_sql: string) {
      await Promise.resolve(); // Simulamos una operación asíncrona
      return `Executed in Tx: ${this.isTransaction}`;
    }
  }

  // Simulamos el Transaction Manager que el developer debe inyectar
  class MockTransactionManager implements ITransactionManager {
    async runInTransaction<T>(action: () => Promise<T>): Promise<T> {
      // Creamos el cliente de base de datos que se usará dentro de la transacción
      const txClient = new MockDatabaseClient();
      // Lo marcamos como transacción
      txClient.isTransaction = true;

      // Iniciamos el contexto de la transacción en el ALS, inyectando el cliente de la transacción
      transactionContext.set("txInstance", txClient);

      // Ejecutamos la acción del usuario
      return await action();
    }
  }

  describe("Proxy de Transacciones (createTransactionProxy)", () => {
    it("Debería usar el cliente global si no hay transacción en el ALS", async () => {
      const globalClient = new MockDatabaseClient();
      const proxy = createTransactionProxy(globalClient);

      // Fuera de requestContext.run(), no hay store
      const result = await proxy.user.create({ name: "Angel" });

      // Usó el cliente global, no la transacción
      expect(result.createdInTx).toBe(false);
    });

    it("Debería redirigir la llamada a la transacción activa si existe en el ALS", async () => {
      const globalClient = new MockDatabaseClient();
      const proxy = createTransactionProxy(globalClient);

      const txClient = new MockDatabaseClient();
      txClient.isTransaction = true;

      await transactionContext.run(
        { isActive: true, txInstance: txClient },
        async () => {
          const result = await proxy.user.create({ name: "Angel" });
          expect(result.createdInTx).toBe(true);
        },
      );
    });

    it("Debería preservar el contexto 'this' al llamar funciones del cliente", async () => {
      const globalClient = new MockDatabaseClient();
      const proxy = createTransactionProxy(globalClient);

      await transactionContext.run({ isActive: false }, async () => {
        const result = await proxy.query("SELECT *");
        expect(result).toBe("Executed in Tx: false");
      });
    });
  });

  describe("Decorador @Transactional", () => {
    // Registramos el TransactionManager en el DI Container para estas pruebas
    beforeEach(() => {
      container.registerInstance(
        TRANSACTION_MANAGER_TOKEN,
        new MockTransactionManager(),
      );
    });

    it("Debería ejecutar el método dentro de una transacción e inicializar el ALS", async () => {
      const globalClient = new MockDatabaseClient();
      const db = createTransactionProxy(globalClient);

      class UserService {
        @Transactional()
        async createUser(name: string) {
          // Si @Transactional funciona, 'db' aquí adentro apuntará a la transacción
          return await db.user.create({ name });
        }
      }

      const service = new UserService();

      const result = await service.createUser("Neu");
      expect(result.createdInTx).toBe(true);
    });

    it("Debería propagar la transacción existente si hay métodos anidados decorados (evita transacciones anidadas)", async () => {
      let txManagerCalls = 0;

      // Secuestramos el manager para contar cuántas veces se inicia una nueva transacción
      const txManager = container.resolve<ITransactionManager>(
        TRANSACTION_MANAGER_TOKEN,
      );

      // Guardamos la implementación original para poder llamarla dentro del mock
      const originalRun = txManager.runInTransaction.bind(txManager);

      // Mockeamos runInTransaction para contar las llamadas y luego delegar a la implementación real
      vi.spyOn(txManager, "runInTransaction").mockImplementation(
        async (action) => {
          txManagerCalls++;
          return await originalRun(action);
        },
      );

      // Clase dummy con servicios anidados decorados con @Transactional
      class OrderService {
        @Transactional()
        async createOrder() {
          return await this.updateInventory(); // Llamada anidada
        }

        @Transactional() // Este decorador NO debe iniciar otra Tx
        async updateInventory() {
          await Promise.resolve(); // Simulamos una operación asíncrona
          return "Inventory Updated";
        }
      }

      const service = new OrderService();

      // Ejecutamos el método principal
      await service.createOrder();

      // El TransactionManager solo debió llamarse 1 vez (para el método principal) evitando multiples transacciones anidadas
      expect(txManagerCalls).toBe(1);
    });

    it("Debería capturar, loguear y re-lanzar errores que ocurran dentro de la transacción", async () => {
      class FailingService {
        @Transactional()
        async failTask() {
          await Promise.resolve(); // Simulamos una operación asíncrona
          throw new Error("Violación de llave única (DB)");
        }
      }

      const service = new FailingService();

      await expect(service.failTask()).rejects.toThrow(
        "Violación de llave única (DB)",
      );

      // Verificamos que el error haya sido logueado por el TransactionManager
      expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("Protección y Casos Extremos", () => {
    it("Debería lanzar un error si se usa @Transactional pero no hay un ITransactionManager registrado", async () => {
      // Limpiamos el contenedor para este test
      container.clearAll();

      class BadService {
        @Transactional()
        async dummy() {
          await Promise.resolve();
          return true;
        }
      }

      const service = new BadService();

      await expect(service.dummy()).rejects.toThrow();
    });
  });
});
