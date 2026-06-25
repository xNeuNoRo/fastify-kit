import { Command } from "commander";
import path from "node:path";
import fs from "node:fs/promises";

/**
 * @description Comando CLI para generar la especificación OpenAPI 3.1 desde una
 * aplicación FastifyKit. Útil para CI/CD, generación de client SDKs y validación.
 *
 * @example
 * ```bash
 * fk generate openapi --module=./src/app.module.ts --output=./openapi.json
 * fk generate openapi --module=./src/app.module.ts --format=yaml --output=./openapi.yaml
 * fk generate openapi --url=http://localhost:3000/docs/json --output=./openapi.json
 * fk generate openapi --module=./src/app.module.ts --include-internal
 * ```
 */
export async function runGenerateOpenApi(options: {
  module?: string;
  url?: string;
  output?: string;
  format?: string;
  includeInternal?: boolean;
}) {
  let spec: any;

  if (options.url) {
    // Fetch desde app corriendo
    try {
      const res = await fetch(options.url);
      if (!res.ok) {
        throw new Error(
          `Error al obtener spec desde ${options.url}: HTTP ${res.status}`,
        );
      }
      spec = await res.json();
    } catch (err: any) {
      console.error(
        `❌ No se pudo obtener la spec desde ${options.url}:`,
        err.message,
      );
      process.exit(1);
    }
  } else if (options.module) {
    // Bootstrap mínimo desde módulo raíz
    const modulePath = path.resolve(options.module);

    // Verificamos que el archivo existe
    try {
      await fs.access(modulePath);
    } catch {
      console.error(`❌ No se encontró el módulo: ${modulePath}`);
      process.exit(1);
    }

    try {
      const { FastifyKit } = await import("../../../core/FastifyKit.js");

      // Import dinámico del módulo del usuario
      const userModule = await import(modulePath);
      const ModuleClass = userModule.default || userModule.AppModule;

      if (!ModuleClass) {
        console.error(
          `❌ No se encontró una exportación 'default' o 'AppModule' en ${modulePath}`,
        );
        process.exit(1);
      }

      const app = await FastifyKit.create({
        module: ModuleClass,
        swagger: { title: "OpenAPI Spec", version: "1.0", description: "" },
        security: {},
        websockets: false,
        multipart: false,
        cookies: false,
      });

      await app.ready();

      // Obtenemos la spec OpenAPI
      spec = (app as any).swagger();

      await app.close();
    } catch (err: any) {
      console.error(
        "❌ Error al generar la especificación OpenAPI:",
        err.message,
      );
      process.exit(1);
    }
  } else {
    console.error(
      "❌ Debes proporcionar --module <path> o --url <url>",
    );
    process.exit(1);
  }

  // Filtrar endpoints internos si no se especifica --include-internal
  if (!options.includeInternal && spec?.paths) {
    delete spec.paths["/health"];
    delete spec.paths["/metrics"];
    delete spec.paths["/docs"];
    delete spec.paths["/docs/"];
  }

  // Formato de salida
  const outputFormat = options.format || "json";
  let output: string;

  if (outputFormat === "yaml") {
    // Usamos una serialización simple YAML (sin dependencia externa)
    output = jsonToYaml(spec);
  } else {
    output = JSON.stringify(spec, null, 2);
  }

  // Salida a archivo o stdout
  if (options.output) {
    const outPath = path.resolve(options.output);
    await fs.writeFile(outPath, output, "utf-8");
    console.log(
      `✅ Especificación OpenAPI 3.1 generada: ${outPath}`,
    );
  } else {
    process.stdout.write(output + "\n");
  }
}

/**
 * @description Convierte un objeto JSON a YAML simple.
 * Solo maneja los casos más comunes de OpenAPI.
 */
function jsonToYaml(obj: any, indent = 0): string {
  const pad = "  ".repeat(indent);
  let yaml = "";

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (typeof item === "object" && item !== null) {
        yaml += `${pad}- `;
        const inner = jsonToYaml(item, indent + 1).trimStart();
        yaml += inner + "\n";
      } else {
        yaml += `${pad}- ${escapeYamlValue(item)}\n`;
      }
    }
  } else if (typeof obj === "object" && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined || value === null) {
        continue;
      }
      if (typeof value === "object" && value !== null) {
        yaml += `${pad}${key}:\n`;
        yaml += jsonToYaml(value, indent + 1);
      } else {
        yaml += `${pad}${key}: ${escapeYamlValue(value)}\n`;
      }
    }
  } else {
    yaml += `${pad}${escapeYamlValue(obj)}\n`;
  }

  return yaml;
}

function escapeYamlValue(
  value: any,
): string {
  if (typeof value === "string") {
    // Si contiene caracteres especiales, envolvemos en comillas
    if (
      /[:\n"'{}[\],&*#?|\-<>=!%@`]/.test(value) ||
      value === "" ||
      value === "true" ||
      value === "false" ||
      value === "null"
    ) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  return `"${String(value)}"`;
}
