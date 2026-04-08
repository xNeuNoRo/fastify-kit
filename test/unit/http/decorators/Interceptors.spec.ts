import { describe, it, expect } from "vitest";

import { UseInterceptors } from "../../../../src/http/decorators/interceptors.js";
import type { FastifyKitMetadata } from "../../../../src/http/decorators/types.js";
import type { Interceptor } from "../../../../src/http/interceptors/Interceptor.js";

describe("Decorador @UseInterceptors", () => {
  // Clases dummy (Mock) para simular interceptores reales
  class DummyInterceptorA implements Interceptor {
    intercept() {
      return null;
    }
  }
  class DummyInterceptorB implements Interceptor {
    intercept() {
      return null;
    }
  }

  it("Debería registrar interceptores a nivel de clase en context.metadata.classInterceptors", () => {
    const metadata: FastifyKitMetadata = {};
    const mockContext = {
      kind: "class",
      metadata,
    } as unknown as ClassDecoratorContext;

    // Aplicamos el decorador
    const decoratorFn = UseInterceptors(DummyInterceptorA, DummyInterceptorB);
    decoratorFn(
      class {
        dummy = true;
      },
      mockContext,
    );

    // Validaciones
    expect(metadata.classInterceptors).toBeDefined();
    expect(metadata.classInterceptors).toHaveLength(2);
    expect(metadata.classInterceptors?.[0]).toBe(DummyInterceptorA);
    expect(metadata.classInterceptors?.[1]).toBe(DummyInterceptorB);
  });

  it("Debería registrar interceptores a nivel de método en context.metadata.routeInterceptors", () => {
    const metadata: FastifyKitMetadata = {};
    const mockContext = {
      kind: "method",
      name: "obtenerUsuarios",
      metadata,
    } as unknown as ClassMethodDecoratorContext;

    // Aplicamos el decorador
    const decoratorFn = UseInterceptors(DummyInterceptorA);
    decoratorFn(() => {}, mockContext);

    // Validaciones
    expect(metadata.routeInterceptors).toBeDefined();
    expect(metadata.routeInterceptors?.obtenerUsuarios).toBeDefined();
    expect(metadata.routeInterceptors?.obtenerUsuarios).toHaveLength(1);
    expect(metadata.routeInterceptors?.obtenerUsuarios[0]).toBe(
      DummyInterceptorA,
    );
  });

  it("Debería lanzar un error si se aplica a algo que no sea clase o método", () => {
    const mockContext = {
      kind: "field", // Simulamos que se aplicó a una propiedad
      metadata: {},
    } as unknown as ClassMethodDecoratorContext;

    const decoratorFn = UseInterceptors(DummyInterceptorA);

    expect(() => decoratorFn(() => {}, mockContext)).toThrow();
  });
});
