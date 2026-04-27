import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import pc from "picocolors";
import ora from "ora";
import { exec } from "node:child_process";
import { promisify } from "node:util";

// Importamos nuestras utilidades globales de nivel superior
import { getRunnerCommand } from "../../utils/package-manager.js";
import { ensureGitIgnore } from "../../utils/gitignore.js";

const execAsync = promisify(exec);

// Definimos la interfaz para recibir opciones desde Commander
export interface PrismaSyncOptions {
  baseFile?: string;
  modelsDir?: string;
  outputFile?: string;
}

export async function runPrismaSync(options: PrismaSyncOptions = {}) {
  // Valores por defecto (convenciones sobre configuración)
  const baseFile = options.baseFile || "prisma/base.prisma";
  const modelsDir = options.modelsDir || "src";
  const outputFile = options.outputFile || "prisma/schema.prisma";

  const spinner = ora(
    `Sincronizando esquemas desde ${pc.cyan(modelsDir)}...`,
  ).start();

  try {
    const basePath = path.resolve(process.cwd(), baseFile);
    let baseContent = "";

    try {
      baseContent = await fs.readFile(basePath, "utf-8");
    } catch (e) {
      spinner.fail(
        pc.red(`No se encontró el esquema base en: ${basePath}\n`) +
          pc.yellow(
            `💡 Tip: Crea este archivo o especifica otra ruta con el flag --base <ruta>`,
          ),
      );
      process.exit(1);
    }

    // Glob requiere forward slashes (/), incluso en Windows, asi que normalizamos
    const searchPattern = `${modelsDir.replaceAll("\\", "/")}/**/*.prisma`;
    // Ignoramos node_modules por si alguien tiene un prisma dentro de sus dependencias (ej. en monorepos)
    const modelFiles = await glob(searchPattern, {
      ignore: "node_modules/**",
    });

    // Si no encontramos modelos, no tiene sentido seguir con la generación
    if (modelFiles.length === 0) {
      spinner.warn(
        pc.yellow(
          `No se encontraron archivos .prisma en el directorio: ${modelsDir}`,
        ),
      );
      return;
    }

    let finalSchema = `// =================================================================\n`;
    finalSchema += `// ⚠️ AUTO-GENERADO POR FASTIFY-KIT ⚠️\n`;
    finalSchema += `// NO EDITES ESTE ARCHIVO DIRECTAMENTE. TUS CAMBIOS SE PERDERÁN.\n`;
    finalSchema += `// =================================================================\n\n`;

    finalSchema += baseContent + "\n\n";

    // Fusionamos los modelos de dominio
    for (const file of modelFiles) {
      const content = await fs.readFile(file, "utf-8");
      finalSchema += `// ---> Origen: ${file}\n`;
      finalSchema += content + "\n\n";
    }

    // Escribimos el esquema unificado en la ubicación de salida deseada
    const outputPath = path.resolve(process.cwd(), outputFile);

    // Asegurarnos de que la carpeta de destino exista (ej. si outputFile es "dist/db/schema.prisma")
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    // Escribimos el esquema unificado
    await fs.writeFile(outputPath, finalSchema);

    // Actualizamos .gitignore de forma inteligente (Monorepo safe)
    await ensureGitIgnore(
      outputFile,
      "Esquema unificado de Prisma por FastifyKit",
    );

    // Detectamos entorno y ejecutamos la generación de cliente de prisma
    const pmCommand = await getRunnerCommand("prisma generate");
    spinner.text = `Generando Prisma Client vía ${pc.gray(pmCommand)}...`;

    await execAsync(pmCommand);

    spinner.succeed(
      pc.green(`Esquema fusionado exitosamente! `) +
        pc.gray(`(${modelFiles.length} módulos detectados)`),
    );
  } catch (error) {
    spinner.fail(
      pc.red(
        "Error crítico sincronizando Prisma: " +
          (error instanceof Error ? error.message : String(error)),
      ),
    );
    process.exit(1);
  }
}
