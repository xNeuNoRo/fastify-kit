import { Command } from "commander";
import { runGenerateOpenApi } from "./openapi.js";

/**
 * @description Registra los comandos de generación en el CLI principal.
 * Actualmente incluye: `fk generate openapi`.
 */
export function registerGenerateCommands(program: Command) {
  const generateCmd = program
    .command("generate")
    .description(
      "Generadores de código y especificaciones desde el framework",
    );

  generateCmd
    .command("openapi")
    .description(
      "Genera la especificación OpenAPI 3.1 desde un módulo raíz o una app corriendo",
    )
    .option(
      "-m, --module <path>",
      "Ruta al módulo raíz (ej: ./src/app.module.ts)",
    )
    .option(
      "-u, --url <url>",
      "URL del endpoint /docs/json de una app corriendo",
    )
    .option(
      "-o, --output <path>",
      "Archivo de salida (default: stdout)",
    )
    .option(
      "-f, --format <json|yaml>",
      "Formato de salida (default: json)",
      "json",
    )
    .option(
      "--include-internal",
      "Incluir endpoints internos (/health, /metrics, /docs) en la spec",
    )
    .action(async (options) => {
      await runGenerateOpenApi({
        module: options.module,
        url: options.url,
        output: options.output,
        format: options.format,
        includeInternal: options.includeInternal,
      });
    });
}
