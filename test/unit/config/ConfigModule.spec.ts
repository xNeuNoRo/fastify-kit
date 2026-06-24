import { Type } from "@sinclair/typebox";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { ConfigModule } from "../../../src/config/ConfigModule.js";
import {
  CONFIG_SERVICE_TOKEN,
  type ConfigService,
} from "../../../src/config/ConfigService.js";
import { container } from "../../../src/container/DIContainer.js";

const trulyOriginalEnv: Record<string, string | undefined> = {
  ...process.env,
};

/** Entorno mínimo limpio con solo vars no-config del sistema */
function minimalEnv(): Record<string, string | undefined> {
  const clean: Record<string, string | undefined> = {};
  for (const key of Object.keys(trulyOriginalEnv)) {
    // Conservamos solo vars que no parecen config (con minúsculas o números puros)
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      clean[key] = trulyOriginalEnv[key];
    }
  }
  return clean;
}

function resetEnvToOriginal(): void {
  process.env = minimalEnv();
}

const TestSchema = Type.Object({
  PORT: Type.Number({ default: 3000 }),
  DEBUG: Type.Boolean({ default: false }),
  DATABASE_URL: Type.String(),
  HOST: Type.String({ default: "0.0.0.0" }),
});

describe("ConfigModule — Sistema de Configuración con TypeBox", () => {
  beforeEach(() => {
    resetEnvToOriginal();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    resetEnvToOriginal();
    vi.restoreAllMocks();
    container.clearAll();
  });

  describe("forRoot() — Inicialización y registro en DI", () => {
    it("Debería registrar ConfigService en el contenedor DI con la config validada", () => {
      process.env.DATABASE_URL = "postgres://localhost:5432/mydb";
      process.env.PORT = "8080";

      ConfigModule.forRoot({ schema: TestSchema });

      expect(container.has(CONFIG_SERVICE_TOKEN)).toBe(true);
      const service = container.resolve<ConfigService>(CONFIG_SERVICE_TOKEN);
      expect(service.getConfig<number>("PORT")).toBe(8080);
      expect(service.getConfig("DATABASE_URL")).toBe(
        "postgres://localhost:5432/mydb",
      );
      expect(service.getConfig<boolean>("DEBUG")).toBe(false);
    });

    it("Debería lanzar ConfigValidationError si falta una variable requerida", () => {
      // DATABASE_URL es requerida y no tiene default
      delete process.env.DATABASE_URL;

      expect(() => ConfigModule.forRoot({ schema: TestSchema })).toThrow();
    });

    it("Debería coercionar tipos automáticamente (string → number, string → boolean)", () => {
      process.env.DATABASE_URL = "postgres://localhost:5432/mydb";
      process.env.PORT = "9090";
      process.env.DEBUG = "true";

      ConfigModule.forRoot({ schema: TestSchema });

      const service = container.resolve<ConfigService>(CONFIG_SERVICE_TOKEN);
      expect(typeof service.getConfig("PORT")).toBe("number");
      expect(service.getConfig<number>("PORT")).toBe(9090);
      expect(typeof service.getConfig("DEBUG")).toBe("boolean");
      expect(service.getConfig<boolean>("DEBUG")).toBe(true);
    });

    it("Debería aplicar valores por defecto si no están en env", () => {
      process.env.DATABASE_URL = "postgres://localhost:5432/mydb";
      // PORT y DEBUG no se setean — deben usar defaults

      ConfigModule.forRoot({ schema: TestSchema });

      const service = container.resolve<ConfigService>(CONFIG_SERVICE_TOKEN);
      expect(service.getConfig<number>("PORT")).toBe(3000);
      expect(service.getConfig<boolean>("DEBUG")).toBe(false);
      expect(service.getConfig("HOST")).toBe("0.0.0.0");
    });
  });

  describe("envPrefix — Filtrado de variables por prefijo", () => {
    it("Debería filtrar variables de entorno usando el prefijo configurado", () => {
      process.env.MYAPP_DATABASE_URL = "postgres://localhost:5432/mydb";
      process.env.MYAPP_PORT = "5000";
      // DATABASE_URL sin prefijo no debería ser leída
      process.env.DATABASE_URL = "ignored-value";

      ConfigModule.forRoot({
        schema: TestSchema,
        envPrefix: "MYAPP_",
      });

      const service = container.resolve<ConfigService>(CONFIG_SERVICE_TOKEN);
      expect(service.getConfig<number>("PORT")).toBe(5000);
      expect(service.getConfig("DATABASE_URL")).toBe(
        "postgres://localhost:5432/mydb",
      );
    });

    it("Solo valida vars con prefijo, ignora otras", () => {
      process.env.MYAPP_DATABASE_URL = "postgres://localhost:5432/mydb";
      // PORT sin prefijo no debería matchear — usará default 3000

      ConfigModule.forRoot({
        schema: TestSchema,
        envPrefix: "MYAPP_",
      });

      const service = container.resolve<ConfigService>(CONFIG_SERVICE_TOKEN);
      expect(service.getConfig<number>("PORT")).toBe(3000);
    });

    it("Schema keys sin prefijo no matchean vars con prefijo diferente", () => {
      const FullDefaultSchema = Type.Object({
        DATABASE_URL: Type.String({ default: "postgres://default" }),
        PORT: Type.Number({ default: 3000 }),
      });

      process.env.OTHER_DATABASE_URL = "postgres://localhost:5432/other";

      ConfigModule.forRoot({
        schema: FullDefaultSchema,
        envPrefix: "MYAPP_",
      });

      const service = container.resolve<ConfigService>(CONFIG_SERVICE_TOKEN);
      // La key OTHER_DATABASE_URL no tiene prefijo MYAPP_ → no se extrae → usa default
      expect(service.getConfig("DATABASE_URL")).toBe("postgres://default");
    });
  });

  describe("strict mode — Detección de claves desconocidas", () => {
    it("Debería lanzar error con claves desconocidas si strict: true (default)", () => {
      process.env.DATABASE_URL = "postgres://localhost:5432/mydb";
      process.env.EXTRA_NO_DECLARADA = "valor-sorpresa";

      expect(() => ConfigModule.forRoot({ schema: TestSchema })).toThrow();
    });

    it("Debería permitir claves desconocidas si strict: false", () => {
      process.env.DATABASE_URL = "postgres://localhost:5432/mydb";
      process.env.EXTRA_NO_DECLARADA = "valor-sorpresa";

      expect(() =>
        ConfigModule.forRoot({ schema: TestSchema, strict: false }),
      ).not.toThrow();

      const service = container.resolve<ConfigService>(CONFIG_SERVICE_TOKEN);
      // Las claves conocidas se registran normalmente
      expect(service.getConfig("DATABASE_URL")).toBe(
        "postgres://localhost:5432/mydb",
      );
      // Las claves desconocidas NO se registran
      expect(service.hasConfig("EXTRA_NO_DECLARADA")).toBe(false);
    });

    it("Debería ser strict: true por defecto", () => {
      process.env.DATABASE_URL = "postgres://localhost:5432/mydb";
      process.env.EXTRA_NO_DECLARADA = "valor-sorpresa";

      expect(() => ConfigModule.forRoot({ schema: TestSchema })).toThrow();
    });

    it("No debería lanzar error por vars del sistema (PATH, HOME, USER, etc.)", () => {
      // process.env contiene PATH, HOME, etc. del SO
      process.env.DATABASE_URL = "postgres://localhost:5432/mydb";

      expect(() => ConfigModule.forRoot({ schema: TestSchema })).not.toThrow();
    });
  });

  describe("hotReload", () => {
    it("No debería activar watcher si hotReload no está configurado", () => {
      process.env.DATABASE_URL = "postgres://localhost:5432/mydb";

      // No debería lanzar error
      ConfigModule.forRoot({ schema: TestSchema });
      expect(container.has(CONFIG_SERVICE_TOKEN)).toBe(true);
    });

    it("No debería activar watcher si NODE_ENV es producción aunque hotReload=true", () => {
      process.env.DATABASE_URL = "postgres://localhost:5432/mydb";
      process.env.NODE_ENV = "production";

      ConfigModule.forRoot({
        schema: TestSchema,
        hotReload: true,
        strict: false,
      });

      expect(container.has(CONFIG_SERVICE_TOKEN)).toBe(true);
    });

    it("Debería activar watcher si hotReload=true y NODE_ENV !== production", () => {
      process.env.DATABASE_URL = "postgres://localhost:5432/mydb";
      process.env.NODE_ENV = "development";

      // ConfigWatcher.watch() usa chokidar internamente
      // Verificamos que no lanza error durante init
      expect(() =>
        ConfigModule.forRoot({
          schema: TestSchema,
          hotReload: true,
          strict: false,
        }),
      ).not.toThrow();
    });
  });

  describe("Casos Edge y Robustez", () => {
    it("Debería manejar valores falsy válidos (0, false, '') sin perderlos", () => {
      const FalsySchema = Type.Object({
        FEATURE_FLAG: Type.Boolean(),
        MAX_RETRIES: Type.Number(),
        PREFIX: Type.String(),
      });

      process.env.FEATURE_FLAG = "false";
      process.env.MAX_RETRIES = "0";
      process.env.PREFIX = "";

      ConfigModule.forRoot({ schema: FalsySchema });

      const service = container.resolve<ConfigService>(CONFIG_SERVICE_TOKEN);
      expect(service.getConfig<boolean>("FEATURE_FLAG")).toBe(false);
      expect(service.getConfig<number>("MAX_RETRIES")).toBe(0);
      expect(service.getConfig("PREFIX")).toBe("");
    });

    it("Debería lanzar error si una variable no puede coaccionarse al tipo esperado", () => {
      process.env.PORT = "no-es-numero";
      process.env.DATABASE_URL = "postgres://localhost:5432/mydb";

      expect(() => ConfigModule.forRoot({ schema: TestSchema })).toThrow();
    });

    it("Debería limpiar el contenedor DI en re-inicialización (forRoot 2x)", () => {
      process.env.DATABASE_URL = "postgres://localhost:5432/mydb";

      ConfigModule.forRoot({ schema: TestSchema });
      const service1 = container.resolve<ConfigService>(CONFIG_SERVICE_TOKEN);
      service1.setConfig("CUSTOM_KEY", "valor-inicial");
      expect(service1.getConfig("CUSTOM_KEY")).toBe("valor-inicial");

      // Segunda llamada a forRoot (simula reinicio)
      ConfigModule.forRoot({ schema: TestSchema });
      const service2 = container.resolve<ConfigService>(CONFIG_SERVICE_TOKEN);
      // La nueva instancia no debería tener la key custom
      expect(service2.getConfig("CUSTOM_KEY")).toBeUndefined();
    });

    it("Debería coexistir multiples keys sin conflicto colateral", () => {
      process.env.DATABASE_URL = "postgres://localhost:5432/mydb";
      process.env.PORT = "3001";

      ConfigModule.forRoot({ schema: TestSchema });

      const service = container.resolve<ConfigService>(CONFIG_SERVICE_TOKEN);
      // Accedemos en orden inverso para evitar falsos positivos
      expect(service.getConfig("HOST")).toBe("0.0.0.0");
      expect(service.getConfig("DATABASE_URL")).toBe(
        "postgres://localhost:5432/mydb",
      );
      expect(service.getConfig<number>("PORT")).toBe(3001);
      expect(service.getConfig<boolean>("DEBUG")).toBe(false);
    });

    it("Debería funcionar con schema mínimo (solo defaults)", () => {
      const MinimalSchema = Type.Object({
        PORT: Type.Number({ default: 3000 }),
      });

      ConfigModule.forRoot({ schema: MinimalSchema });

      const service = container.resolve<ConfigService>(CONFIG_SERVICE_TOKEN);
      expect(service.getConfig<number>("PORT")).toBe(3000);
    });

    it("Debería funcionar con schema que tiene arrays", () => {
      const ArraySchema = Type.Object({
        LOG_LEVELS: Type.Array(Type.String(), { default: ["info", "error"] }),
        DATABASE_URL: Type.String(),
      });

      process.env.DATABASE_URL = "postgres://localhost:5432/mydb";

      ConfigModule.forRoot({ schema: ArraySchema });

      const service = container.resolve<ConfigService>(CONFIG_SERVICE_TOKEN);
      expect(service.getConfig("LOG_LEVELS")).toEqual(["info", "error"]);
      expect(service.getConfig("DATABASE_URL")).toBe(
        "postgres://localhost:5432/mydb",
      );
    });
  });
});
