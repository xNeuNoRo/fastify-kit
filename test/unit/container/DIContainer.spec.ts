import { describe, it, expect } from "vitest";

import { container } from "../../../src/container/DIContainer.js";
import { Inject } from "../../../src/container/inject.decorator.js";
import { Injectable } from "../../../src/container/injectable.decorator.js";

describe("DIContainer (Dependency Injection Container)", () => {
  describe("Comportamiento Esperado y Gestión de Instancias", () => {
    it("Deberia registrar y resolver una clase sin dependencias", () => {
      class DatabaseService {
        connect() {
          return true;
        }
      }

      container.registerClass(DatabaseService, DatabaseService);

      const instance = container.resolve<DatabaseService>(DatabaseService);

      expect(instance).toBeDefined();
      expect(instance).toBeInstanceOf(DatabaseService);
      expect(instance.connect()).toBe(true);
    });

    it("Deberia mantener el patron Singleton en multiples resoluciones de la misma clase", () => {
      class CacheService {
        public count = 0;
        increment() {
          this.count++;
        }
      }
      container.registerClass(CacheService, CacheService);

      const instance = container.resolve<CacheService>(CacheService);
      instance.increment();
      instance.increment();

      const anotherInstance = container.resolve<CacheService>(CacheService);

      expect(anotherInstance).toBe(instance);
      expect(anotherInstance.count).toBe(2);
    });

    it("Deberia permitir registrar una implementacion diferente para un contrato y resolverla correctamente", () => {
      abstract class ILogger {
        abstract log(): string;
      }
      class ConsoleLogger extends ILogger {
        log() {
          return "Logueando a la consola";
        }
      }

      container.registerClass(ILogger, ConsoleLogger);

      const instance = container.resolve<ILogger>(ILogger);

      expect(instance).toBeDefined();
      expect(instance).toBeInstanceOf(ConsoleLogger);
      expect(instance.log()).toBe("Logueando a la consola");
    });

    it("Deberia permitir registrar y resolver una instancia pre-creada directamente con registerInstance", () => {
      class DatabaseConnection {
        public isConnected = true;
      }

      const preCreatedDb = new DatabaseConnection();
      preCreatedDb.isConnected = false; // Simulamos una conexión cerrada

      container.registerInstance(DatabaseConnection, preCreatedDb);

      const resolved =
        container.resolve<DatabaseConnection>(DatabaseConnection);

      expect(resolved).toBeDefined();
      expect(resolved).toBe(preCreatedDb);
      expect(resolved.isConnected).toBe(false);
    });
  });

  describe("Resolución de Dependencias Anidadas", () => {
    it("Deberia auto-registrar con @Injectable y resolver propiedades con @Inject", () => {
      @Injectable()
      class ConfigService {
        getApiKey() {
          return "123456789-ABDCDEFGHIJ";
        }
      }

      @Injectable()
      class ApiClient {
        @Inject(ConfigService)
        public config!: ConfigService;
      }

      const client = container.resolve<ApiClient>(ApiClient);

      expect(client).toBeDefined();
      expect(client).toBeInstanceOf(ApiClient);
      expect(client.config).toBeDefined();
      expect(client.config).toBeInstanceOf(ConfigService);
      expect(client.config.getApiKey()).toBe("123456789-ABDCDEFGHIJ");
    });

    it("Deberia lanzar un error si @Inject se aplica a algo que no sea una propiedad", () => {
      expect(() => {
        class InvalidUsage {
          declare public dummy: unknown;

          constructor() {
            const injectFn = Inject(
              class Dummy {
                public dummy = true;
              },
            );
            injectFn(undefined, { kind: "method", name: "someMethod" } as any);
          }
        }

        return new InvalidUsage();
      }).toThrow("@Inject solo puede ser aplicado a campos de clase");
    });

    it("Deberia lanzar un error si @Injectable se aplica a algo que no sea una clase", () => {
      expect(() => {
        const sum = (a: number, b: number) => a + b;
        Injectable()(sum as any, { kind: "function", name: "sum" } as any);
      }).toThrow("@Injectable solo puede ser aplicado a clases");
    });
  });

  describe("Validaciones, Excepciones y Mocks", () => {
    it("Deberia lanzar un error al intentar resolver un contrato abstracto o Symbol no registrado", () => {
      const UnregisteredToken = Symbol("UnregisteredService");

      expect(() => container.resolve(UnregisteredToken)).toThrow(
        `No se ha registrado una implementación para el contrato: Symbol(UnregisteredService)`,
      );
    });

    it("Deberia autodescubrir las dependencias no registradas y registrarlas automaticamente", () => {
      class Config {
        getValue() {
          return "Valor de configuración";
        }
      }

      @Injectable()
      class ServiceA {
        @Inject(Config)
        public dependency!: Config;
      }

      const instance = container.resolve<ServiceA>(ServiceA);

      expect(instance).toBeDefined();
      expect(instance).toBeInstanceOf(ServiceA);
      expect(instance.dependency).toBeDefined();
      expect(instance.dependency).toBeInstanceOf(Config);
      expect(instance.dependency.getValue()).toBe("Valor de configuración");
    });

    it("Deberia sobreescribir la implementacion registrada si se registra una nueva con la misma key", () => {
      class AuthService {
        isValid() {
          return false;
        }
      }
      class MockAuthService {
        isValid() {
          return true;
        }
      }

      container.registerClass(AuthService, AuthService);
      const original = container.resolve<AuthService>(AuthService);
      container.registerClass(AuthService, MockAuthService);
      const mocked = container.resolve<AuthService>(AuthService);

      expect(original.isValid()).toBe(false);
      expect(mocked.isValid()).toBe(true);
    });
  });
});
