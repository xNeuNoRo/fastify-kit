import { describe, it, expect } from "vitest";

import { container, ScopeType } from "../../../src/container/DIContainer.js";
import {
  Inject,
  Optional,
  PostConstruct,
} from "../../../src/container/inject.decorator.js";
import { Injectable } from "../../../src/container/injectable.decorator.js";
import { Scope } from "../../../src/container/scope.decorator.js";
import { requestContext } from "../../../src/http/context/requestContext.js";

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
      }).toThrow();
    });

    it("Deberia lanzar un error si @Injectable se aplica a algo que no sea una clase", () => {
      expect(() => {
        const sum = (a: number, b: number) => a + b;
        Injectable()(sum as any, { kind: "function", name: "sum" } as any);
      }).toThrow();
    });
  });

  describe("Validaciones, Excepciones y Mocks", () => {
    it("Deberia lanzar un error al intentar resolver un contrato abstracto o Symbol no registrado", () => {
      const UnregisteredToken = Symbol("UnregisteredService");

      expect(() => container.resolve(UnregisteredToken)).toThrow();
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

  describe("Ciclos de Vida (Scopes)", () => {
    it("Scope.Singleton: Debería compartir la misma instancia siempre", () => {
      @Injectable()
      class SingletonSrv {
        public id = Math.random();
      }

      const i1 = container.resolve(SingletonSrv);
      const i2 = container.resolve(SingletonSrv);

      expect(i1.id).toBe(i2.id);
      expect(i1).toBe(i2);
    });

    it("Scope.Transient: Debería crear una instancia nueva cada vez", () => {
      @Scope(ScopeType.Transient)
      @Injectable()
      class TransientSrv {
        public id = Math.random();
      }

      const i1 = container.resolve(TransientSrv);
      const i2 = container.resolve(TransientSrv);

      expect(i1.id).not.toBe(i2.id);
      expect(i1).not.toBe(i2);
    });

    it("Scope.Request: Debería aislar instancias por contexto de petición", () => {
      @Scope(ScopeType.Request)
      @Injectable()
      class RequestSrv {
        public id = Math.random();
      }

      let id1: number, id2: number, id3: number;

      // Simulamos Petición A
      requestContext.run({ requestId: "A", diInstances: new Map() }, () => {
        const i1 = container.resolve(RequestSrv);
        const i2 = container.resolve(RequestSrv);
        id1 = i1.id;
        id2 = i2.id;
      });

      // Simulamos Petición B
      requestContext.run({ requestId: "B", diInstances: new Map() }, () => {
        const i3 = container.resolve(RequestSrv);
        id3 = i3.id;
      });

      expect(id1!).toBe(id2!); // Misma petición, misma instancia
      expect(id1!).not.toBe(id3!); // Diferente petición, diferente instancia
    });

    it("Scope.Request: Debería lanzar error si se resuelve fuera de contexto", () => {
      @Scope(ScopeType.Request)
      @Injectable()
      class RequestSrv {}

      expect(() => container.resolve(RequestSrv)).toThrow(
        /fuera de un contexto de petición/,
      );
    });
  });

  describe("Dependencias Circulares (Hybrid Eager/Lazy)", () => {
    it("Debería resolver ciclos complejos A -> B -> A automáticamente", () => {
      @Injectable()
      class ClassA {
        @Inject(() => ClassB) public b!: any;
      }

      @Injectable()
      class ClassB {
        @Inject(() => ClassA) public a!: any;
      }

      const a = container.resolve(ClassA);
      const b = a.b;

      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(b.a).toBe(a); // El ciclo se cerró correctamente
    });
  });

  describe("Inyección Opcional (@Optional)", () => {
    it("Debería inyectar undefined si la dependencia no existe y es @Optional", () => {
      class MissingSrv {
        dummy = true;
      }

      @Injectable()
      class HostSrv {
        @Optional()
        @Inject(MissingSrv)
        public missing?: MissingSrv;
      }

      const host = container.resolve(HostSrv);
      expect(host.missing).toBeUndefined();
    });

    it("Debería lanzar error si la dependencia no existe y NO es @Optional", () => {
      const TOKEN = Symbol("Missing");
      @Injectable()
      class HostSrv {
        @Inject(TOKEN) public missing: any;
      }

      expect(() => container.resolve(HostSrv)).toThrow();
    });
  });

  describe("Fábricas (Factory Providers)", () => {
    it("Debería resolver una instancia desde una función factory", () => {
      const TOKEN = Symbol("FACTORY");
      container.registerFactory(TOKEN, () => ({
        createdBy: "factory",
        time: Date.now(),
      }));

      const obj = container.resolve<any>(TOKEN);
      expect(obj.createdBy).toBe("factory");
    });

    it("La factory debería poder inyectar otras dependencias del contenedor", () => {
      @Injectable()
      class InternalSrv {
        public value = "OK";
      }

      const TOKEN = Symbol("DEPENDENT_FACTORY");
      container.registerFactory(TOKEN, (c) => {
        const internal = c.resolve(InternalSrv);
        return { status: internal.value };
      });

      const obj = container.resolve<any>(TOKEN);
      expect(obj.status).toBe("OK");
    });

    it("Debería respetar el scope en las fábricas", () => {
      const TOKEN = Symbol("TRANSIENT_FACTORY");
      let count = 0;
      container.registerFactory(
        TOKEN,
        () => ({ id: ++count }),
        ScopeType.Transient,
      );

      const o1 = container.resolve<any>(TOKEN);
      const o2 = container.resolve<any>(TOKEN);

      expect(o1.id).toBe(1);
      expect(o2.id).toBe(2);
      expect(o1).not.toBe(o2);
    });
  });

  describe("Hooks de Vida (@PostConstruct)", () => {
    it("Debería ejecutar el método @PostConstruct tras la inyección", () => {
      @Injectable()
      class Dependency {
        public ready = true;
      }

      @Injectable()
      class PostSrv {
        public initialized = false;
        public depReady = false;

        @Inject(Dependency) public dep: any;

        @PostConstruct()
        init() {
          this.initialized = true;
          this.depReady = this.dep?.ready;
        }
      }

      const instance = container.resolve(PostSrv);
      expect(instance.initialized).toBe(true);
      expect(instance.depReady).toBe(true);
    });

    it("Debería capturar errores en @PostConstruct y propagarlos si fallan", async () => {
      await Promise.resolve(); // Para simular async

      @Injectable()
      class FailingPostSrv {
        @PostConstruct()
        init() {
          throw new Error("Sync Boom");
        }
      }

      expect(() => container.resolve(FailingPostSrv)).toThrow();
    });
  });

  describe("Clean Architecture (State vs logic)", () => {
    it("El contenedor debería mantener su estado incluso tras múltiples resoluciones complejas", () => {
      @Injectable()
      class Srv {}

      container.resolve(Srv);
      container.resolve(Srv);

      // Acceso a propiedad privada vía cast para verificar limpieza de memoria interna
      expect((container as any).resolutionStack.size).toBe(0);
    });
  });
});
