import { describe, it, expect } from "vitest";

import { StaticAssets } from "../../../../src/http/decorators/static.js";
import type { FastifyKitMetadata } from "../../../../src/http/decorators/types.js";

describe("Decorador @StaticAssets", () => {
  it("Deberia inyectar la configuración estática en la metadata de la clase", () => {
    const options = { root: "/public/images", compress: true };
    const metadata: Partial<FastifyKitMetadata> = {};
    const context: any = { kind: "class", metadata };

    // Ejecutamos el decorador simulado de JS nativo
    const decorator = StaticAssets(options);
    decorator(
      class TestController {
        dummy() {
          return "dummy";
        }
      },
      context,
    );

    expect(metadata.staticAssets).toBeDefined();
    expect(metadata.staticAssets?.root).toBe("/public/images");
    expect(metadata.staticAssets?.compress).toBe(true);
  });

  it("Deberia lanzar una excepción si se intenta aplicar a un método", () => {
    const context: any = { kind: "method", metadata: {} };
    const decorator = StaticAssets({ root: "/public" });

    expect(() => decorator(() => {}, context)).toThrow();
  });
});
