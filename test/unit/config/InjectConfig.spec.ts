import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { ConfigRegistry } from "../../../src/config/ConfigRegistry.js";
import { CONFIG_SERVICE_TOKEN } from "../../../src/config/ConfigService.js";
import { DefaultConfigService } from "../../../src/config/DefaultConfigService.js";
import { InjectConfig } from "../../../src/config/inject-config.decorator.js";
import { container } from "../../../src/container/DIContainer.js";

describe("@InjectConfig — API Nueva (ConfigService via DI)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    container.clearAll();
    ConfigRegistry.clear();
  });

  describe("Con ConfigService registrado en DI (modo nuevo)", () => {
    beforeEach(() => {
      const service = new DefaultConfigService();
      service.setConfig("DATABASE_URL", "postgres://localhost:5432/mydb");
      service.setConfig("PORT", 3000);
      service.setConfig("DEBUG", false);
      container.registerInstance(CONFIG_SERVICE_TOKEN, service);
    });

    it("Debería inyectar config desde ConfigService cuando existe en DI", () => {
      class MyService {
        @InjectConfig("DATABASE_URL")
        readonly dbUrl!: string;

        @InjectConfig("PORT")
        readonly port!: number;
      }

      const service = new MyService();
      expect(service.dbUrl).toBe("postgres://localhost:5432/mydb");
      expect(service.port).toBe(3000);
    });

    it("Debería retornar el valor por defecto si el namespace no existe en ConfigService", () => {
      class MyService {
        @InjectConfig("CLAVE_INEXISTENTE")
        readonly clave: string = "valor-por-defecto";
      }

      const service = new MyService();
      expect(service.clave).toBe("valor-por-defecto");
    });

    it("No debería loggear warning de deprecación si ConfigService existe", () => {
      class MyService {
        @InjectConfig("DATABASE_URL")
        readonly dbUrl!: string;
      }

      new MyService();
      expect(console.warn).not.toHaveBeenCalled();
    });

    it("No debería hacer fallback a ConfigRegistry si ConfigService existe", () => {
      // Seteamos algo en ConfigRegistry que NO debería ser usado
      ConfigRegistry.set("DATABASE_URL", "registry-value-should-be-ignored");

      class MyService {
        @InjectConfig("DATABASE_URL")
        readonly dbUrl!: string;
      }

      const service = new MyService();
      // Debe usar ConfigService, NO ConfigRegistry
      expect(service.dbUrl).toBe("postgres://localhost:5432/mydb");
    });

    it("Debería inyectar correctamente valores booleanos", () => {
      class MyService {
        @InjectConfig("DEBUG")
        readonly debug!: boolean;
      }

      const service = new MyService();
      expect(service.debug).toBe(false);
    });

    it("Debería inyectar correctamente valores numéricos", () => {
      class MyService {
        @InjectConfig("PORT")
        readonly port!: number;
      }

      const service = new MyService();
      expect(service.port).toBe(3000);
    });

    it("Debería manejar múltiples @InjectConfig en la misma clase", () => {
      class MyService {
        @InjectConfig("DATABASE_URL")
        readonly dbUrl!: string;

        @InjectConfig("PORT")
        readonly port!: number;

        @InjectConfig("DEBUG")
        readonly debug!: boolean;
      }

      const service = new MyService();
      expect(service.dbUrl).toBe("postgres://localhost:5432/mydb");
      expect(service.port).toBe(3000);
      expect(service.debug).toBe(false);
    });
  });

  describe("Sin ConfigService registrado (fallback ConfigRegistry)", () => {
    beforeEach(() => {
      // NO registramos ConfigService en el DI
      ConfigRegistry.set("database", {
        host: "localhost",
        port: 5432,
      });
    });

    it("Debería hacer fallback a ConfigRegistry y loggear warning", () => {
      class DatabaseService {
        @InjectConfig("database")
        readonly config!: { host: string; port: number };

        getConfig() {
          return this.config;
        }
      }

      const service = new DatabaseService();
      const config = service.getConfig();

      expect(config).toBeDefined();
      expect(config.host).toBe("localhost");
      expect(config.port).toBe(5432);
      expect(console.warn).toHaveBeenCalled();
    });

    it("Debería respetar el valor por defecto si ConfigRegistry no tiene la key", () => {
      class AuthService {
        @InjectConfig("nonexistent")
        readonly apiKey: string = "default-api-key";
      }

      const service = new AuthService();
      expect(service.apiKey).toBe("default-api-key");
    });
  });

  describe("Validaciones del decorador", () => {
    it("Debería lanzar error si @InjectConfig se aplica a un método", () => {
      expect(() => {
        const injectFn = InjectConfig("SOME_KEY");
        injectFn(undefined, {
          kind: "method",
          name: "badMethod",
        } as any);
      }).toThrow();
    });

    it("Debería preservar valores falsy del ConfigService (0, false, '')", () => {
      const service = new DefaultConfigService();
      service.setConfig("MAX_RETRIES", 0);
      service.setConfig("FEATURE_FLAG", false);
      service.setConfig("PREFIX", "");
      container.registerInstance(CONFIG_SERVICE_TOKEN, service);

      class ConfigService {
        @InjectConfig("MAX_RETRIES")
        readonly maxRetries!: number;

        @InjectConfig("FEATURE_FLAG")
        readonly featureFlag!: boolean;

        @InjectConfig("PREFIX")
        readonly prefix!: string;
      }

      const svc = new ConfigService();
      expect(svc.maxRetries).toBe(0);
      expect(svc.featureFlag).toBe(false);
      expect(svc.prefix).toBe("");
    });
  });
});
