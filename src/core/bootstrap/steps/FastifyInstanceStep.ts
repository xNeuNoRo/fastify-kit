import ajvFormats from "ajv-formats";
import fastify, { type FastifyServerOptions } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { BootstrapContext, BootstrapStep } from "../BootstrapPipeline.js";

/**
 * @description Paso 2 del pipeline: Creación de la instancia de Fastify.
 *
 * Crea la instancia de Fastify con:
 * - Las opciones proporcionadas por el usuario (http2, https, etc.).
 * - Configuración de AJV optimizada para TypeBox (strict: false, ajv-formats).
 * - Type provider de TypeBox para validación tipada.
 */
export class FastifyInstanceStep implements BootstrapStep {
  readonly name = "FastifyInstanceStep";

  async execute(ctx: BootstrapContext): Promise<void> {
    const userAjv = ctx.options.fastifyOptions?.ajv;
    const isAjvObject = typeof userAjv === "object" && userAjv !== null;

    const app = fastify({
      ...ctx.options.fastifyOptions,
      ajv: {
        // Preservamos las opciones ajv del usuario (si existen)
        ...(isAjvObject ? userAjv : {}),
        customOptions: {
          // Preservamos las customOptions del usuario (si existen)
          ...(isAjvObject ? userAjv.customOptions : {}),
          strict: false, // Forzamos nuestro requerimiento crítico para TypeBox
        },
        plugins: [
          [(ajvFormats as any).default ?? ajvFormats, { mode: "fast" }],
        ] as unknown as any[],
      } as FastifyServerOptions["ajv"],
    }).withTypeProvider<TypeBoxTypeProvider>();

    ctx.app = app;
  }
}
