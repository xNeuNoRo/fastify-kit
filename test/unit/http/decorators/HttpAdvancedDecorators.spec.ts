import { describe, it, expect } from "vitest";

import { UseGuards } from "../../../../src/http/decorators/guards.js";
import { RateLimit } from "../../../../src/http/decorators/rate-limit.js";
import type { FastifyKitMetadata } from "../../../../src/http/decorators/types.js";
import { Version } from "../../../../src/http/decorators/version.js";

// Aseguramos que Symbol.metadata esté definido para almacenar la metadata de los decoradores
if (!(Symbol as any).metadata) {
  (Symbol as any).metadata = Symbol.for("Symbol.metadata");
}

describe("Decoradores HTTP Avanzados (Guards, RateLimit, Version)", () => {
  // Mocks de Guards para pruebas
  class AuthGuard {
    canActivate() {
      return true;
    }
  }
  class RolesGuard {
    canActivate() {
      return true;
    }
  }

  describe("Decorador @UseGuards", () => {
    it("Debería registrar guards a nivel de clase en 'classGuards'", () => {
      @UseGuards(AuthGuard)
      class ProtectedController {}

      const metadata = (ProtectedController as any)[
        (Symbol as any).metadata
      ] as FastifyKitMetadata;

      expect(metadata.classGuards).toBeDefined();
      expect(Array.isArray(metadata.classGuards)).toBe(true);
      expect(metadata.classGuards).toContain(AuthGuard);
    });

    it("Debería registrar guards a nivel de método en 'routeGuards' mapeados por nombre", () => {
      class TestController {
        @UseGuards(RolesGuard)
        async secureMethod() {
          /* dummy method */
        }
      }

      const metadata = (TestController as any)[
        (Symbol as any).metadata
      ] as FastifyKitMetadata;

      expect(metadata.routeGuards).toBeDefined();
      expect(metadata.routeGuards?.["secureMethod"]).toContain(RolesGuard);
    });

    it("Debería concatenar guards si se aplican múltiples veces", () => {
      @UseGuards(AuthGuard)
      @UseGuards(RolesGuard)
      class MultiGuardController {}

      // Accedemos a la metadata para verificar que ambos guards estén registrados en 'classGuards'
      const metadata = (MultiGuardController as any)[
        (Symbol as any).metadata
      ] as FastifyKitMetadata;

      expect(metadata.classGuards).toBeDefined();
      expect(metadata.classGuards).toHaveLength(2);
      expect(metadata.classGuards).toContain(AuthGuard);
      expect(metadata.classGuards).toContain(RolesGuard);
    });

    it("Debería lanzar error si se aplica a algo que no es clase ni método (ej: campo)", () => {
      expect(() => {
        const decorator = UseGuards(AuthGuard);
        decorator(Object, { kind: "field", name: "prop", metadata: {} } as any);
      }).toThrow();
    });
  });

  describe("@RateLimit", () => {
    it("Debería almacenar las opciones de rate limit en la metadata del método", () => {
      const options = { max: 10, timeWindow: 60000 };

      class LimitedController {
        @RateLimit(options)
        async limitedMethod() {
          /* dummy method */
        }
      }

      const metadata = (LimitedController as any)[
        (Symbol as any).metadata
      ] as FastifyKitMetadata;

      expect(metadata.rateLimits).toBeDefined();
      expect(metadata.rateLimits?.["limitedMethod"]).toEqual(options);
    });

    it("Debería lanzar error si se aplica a una clase", () => {
      expect(() => {
        const decorator = RateLimit({ max: 10, timeWindow: 60000 });
        decorator(
          class {
            dummy = true;
          },
          { kind: "class", name: "Test" } as any,
        );
      }).toThrow();
    });
  });

  describe("@Version", () => {
    it("Debería asignar la versión a la metadata de la clase", () => {
      @Version("v1")
      class V1Controller {}

      // Accedemos a la metadata almacenada en Symbol.metadata para verificar que la versión se asignó correctamente
      const metadata = (V1Controller as any)[
        (Symbol as any).metadata
      ] as FastifyKitMetadata;

      // Verificamos que la propiedad 'version' esté definida y tenga el valor correcto
      expect(metadata.version).toBeDefined();
      expect(metadata.version).toBe("v1");
    });

    it("Debería asignar la versión a la metadata del método en 'methodVersions'", () => {
      class MultiVersionController {
        @Version("v2")
        async newMethod() {
          /* dummy method */
        }
      }

      // Accedemos a la metadata almacenada en Symbol.metadata para verificar que la versión se asignó correctamente al método
      const metadata = (MultiVersionController as any)[
        (Symbol as any).metadata
      ] as FastifyKitMetadata;

      // Verificamos que la propiedad 'methodVersions' esté definida y que el método 'newMethod' tenga la versión correcta asignada
      expect(metadata.methodVersions).toBeDefined();
      expect(metadata.methodVersions?.["newMethod"]).toBe("v2");
    });

    it("Debería lanzar error si se aplica a un contexto inválido", () => {
      expect(() => {
        const decorator = Version("1");
        decorator(Object, { kind: "field", name: "prop" } as any);
      }).toThrow();
    });
  });
});
