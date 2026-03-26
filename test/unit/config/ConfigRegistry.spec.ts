import { describe, it, expect, beforeEach } from "vitest";

import { ConfigRegistry } from "../../../src/config/ConfigRegistry.js";
import { InjectConfig } from "../../../src/config/inject-config.decorator.js";

describe("Sistema de Configuración (ConfigRegistry & @InjectConfig)", () => {
  // Esto se ejecuta antes de cada "it" para asegurarnos de que el ConfigRegistry esté limpio antes de cada prueba
  beforeEach(() => {
    // Limpiar el ConfigRegistry antes de cada prueba
    ConfigRegistry.clear();
  });

  describe("Gestión de Estado y Recuperación (ConfigRegistry)", () => {
    it("Deberia cargar configuraciones masivamente y recuperarlas", () => {
      const environmentConfig = {
        NODE_ENV: "production",
        PORT: 3000,
      };
      ConfigRegistry.set("environment", environmentConfig);

      const retrievedConfig =
        ConfigRegistry.get<typeof environmentConfig>("environment");

      expect(retrievedConfig).toEqual(environmentConfig);
      expect(retrievedConfig?.NODE_ENV).toBe("production");
      expect(retrievedConfig?.PORT).toBe(3000);
    });

    it("Deberia retornar undefined para namespaces no existentes", () => {
      const nonExistentConfig = ConfigRegistry.get("environment");
      expect(nonExistentConfig).toBeUndefined();
    });

    it("Deberia sobreescribir configuraciones existentes", () => {
      const initialConfig = {
        NODE_ENV: "development",
        PORT: 3000,
      };
      ConfigRegistry.set("environment", initialConfig);

      const newConfig = {
        NODE_ENV: "production",
        PORT: 8080,
      };
      ConfigRegistry.set("environment", newConfig);

      const retrievedConfig =
        ConfigRegistry.get<typeof newConfig>("environment");

      expect(retrievedConfig).toEqual(newConfig);
      expect(retrievedConfig?.NODE_ENV).toBe("production");
      expect(retrievedConfig?.PORT).toBe(8080);
    });

    it("Deberia verificar la existencia de configuraciones", () => {
      expect(ConfigRegistry.has("environment")).toBe(false);

      const environmentConfig = {
        NODE_ENV: "production",
        PORT: 3000,
      };
      ConfigRegistry.set("environment", environmentConfig);

      expect(ConfigRegistry.has("environment")).toBe(true);
      expect(ConfigRegistry.has("nonexistent")).toBe(false);
    });

    it("Deberia eliminar una configuración específica con delete()", () => {
      ConfigRegistry.set("api", { url: "https://api.example.com" });

      // Verificamos que se elimina correctamente (retorna true)
      const wasDeleted = ConfigRegistry.delete("api");
      expect(wasDeleted).toBe(true);
      expect(ConfigRegistry.has("api")).toBe(false);

      // Verificamos que retorna false si intentamos eliminar algo que no existe
      const wasDeletedAgain = ConfigRegistry.delete("api");
      expect(wasDeletedAgain).toBe(false);
    });

    it("Deberia limpiar todas las configuraciones", () => {
      const environmentConfig = {
        NODE_ENV: "production",
        PORT: 3000,
      };

      ConfigRegistry.set("environment", environmentConfig);
      expect(ConfigRegistry.has("environment")).toBe(true);

      ConfigRegistry.clear();
      expect(ConfigRegistry.has("environment")).toBe(false);
    });
  });

  describe("Inyección en Clases (@InjectConfig)", () => {
    it("Deberia inyectar la configuración dinámicamente en una propiedad de clase", () => {
      const databaseConfig = {
        host: "localhost",
        port: 5432,
        username: "user",
        password: "password_1234",
      };
      ConfigRegistry.set("database", databaseConfig);

      class DatabaseService {
        @InjectConfig("database")
        private readonly config!: typeof databaseConfig;

        getConfig() {
          return this.config;
        }
      }

      const service = new DatabaseService();
      const injectedConfig = service.getConfig();

      expect(injectedConfig).toBeDefined();
      expect(injectedConfig).toEqual(databaseConfig);
      expect(injectedConfig?.host).toBe("localhost");
      expect(injectedConfig?.port).toBe(5432);
      expect(injectedConfig?.username).toBe("user");
      expect(injectedConfig?.password).toBe("password_1234");
    });

    it("Deberia retornar undefined si la configuración no existe al inyectar", () => {
      class SomeService {
        @InjectConfig("nonexistent")
        private readonly config?: any;

        getConfig() {
          return this.config;
        }
      }

      const service = new SomeService();
      const injectedConfig = service.getConfig();

      expect(injectedConfig).toBeUndefined();
    });

    it("Deberia respetar el valor por defecto de la propiedad si la configuración no existe en el Registry", () => {
      class ServerService {
        // Le asignamos un valor por defecto explícito
        @InjectConfig("server_port")
        public readonly port: number = 8080;
      }

      const service = new ServerService();

      // Como "server_port" no existe en el registry, debe mantener el 8080
      expect(service.port).toBe(8080);
    });

    it("Deberia actualizar la configuración inyectada dinámicamente", () => {
      const initialConfig = {
        host: "localhost",
        port: 5432,
        username: "user",
        password: "password_1234",
      };
      ConfigRegistry.set("database", initialConfig);

      class DatabaseService {
        @InjectConfig("database")
        private readonly config!: typeof initialConfig;

        getConfig() {
          return this.config;
        }
      }

      const service = new DatabaseService();
      const injectedConfig = service.getConfig();

      expect(injectedConfig).toBeDefined();
      expect(injectedConfig).toEqual(initialConfig);
      expect(injectedConfig?.host).toBe("localhost");
      expect(injectedConfig?.port).toBe(5432);
      expect(injectedConfig?.username).toBe("user");
      expect(injectedConfig?.password).toBe("password_1234");

      const updatedConfig = {
        host: "db.example.com",
        port: 5432,
        username: "admin",
        password: "new_password_5678",
      };
      ConfigRegistry.set("database", updatedConfig);

      const newService = new DatabaseService();
      const newInjectedConfig = newService.getConfig();

      expect(newInjectedConfig).toBeDefined();
      expect(newInjectedConfig).toEqual(updatedConfig);
      expect(newInjectedConfig?.host).toBe("db.example.com");
      expect(newInjectedConfig?.port).toBe(5432);
      expect(newInjectedConfig?.username).toBe("admin");
      expect(newInjectedConfig?.password).toBe("new_password_5678");
    });
  });

  describe("Edge Cases y Validaciones", () => {
    it("Deberia lanzar un error si @InjectConfig se aplica a un método en lugar de una propiedad", () => {
      expect(() => {
        class InvalidUsage {
          declare public dummy: unknown;

          constructor() {
            // Simulamos el mal uso del decorador
            const injectFn = InjectConfig("SOME_KEY");
            injectFn(undefined, { kind: "method", name: "badMethod" } as any);
          }
        }

        return new InvalidUsage();
      }).toThrow();
    });

    it("Deberia recuperar correctamente valores 'falsy' válidos (0, false, '')", () => {
      const falsyConfig = {
        FEATURE_FLAG: false,
        MAX_RETRIES: 0,
        PREFIX: "",
      };

      ConfigRegistry.set("test", falsyConfig);
      const retrievedConfig = ConfigRegistry.get<typeof falsyConfig>("test");

      expect(retrievedConfig).toBeDefined();
      expect(retrievedConfig?.FEATURE_FLAG).toBe(false);
      expect(retrievedConfig?.MAX_RETRIES).toBe(0);
      expect(retrievedConfig?.PREFIX).toBe("");
    });
  });
});
