import { Command } from "commander";
import { runPrismaSync } from "./sync.js";
import { runPrismaWatch } from "./watch.js";

export function registerPrismaCommands(program: Command) {
  // Agrupamos bajo el comando principal "prisma"
  const prismaCmd = program
    .command("prisma")
    .description(
      "Herramientas para gestionar Prisma en dominios modulares, incluyendo sincronización y generación de cliente",
    );

  // Subcomando => fk prisma sync
  prismaCmd
    .command("sync")
    .description("Fusiona los .prisma de los módulos y genera el cliente")
    // Definimos los flags con sus valores por defecto para que el dev tenga control total
    .option(
      "-b, --base <path>",
      "Ruta al archivo base de Prisma",
      "prisma/base.prisma",
    )
    .option(
      "-d, --dir <path>",
      "Directorio a escanear en busca de modelos",
      "src",
    )
    .option(
      "-o, --out <path>",
      "Ruta de salida del schema fusionado",
      "prisma/schema.prisma",
    )
    .action(async (options) => {
      try {
        await runPrismaSync({
          baseFile: options.base,
          modelsDir: options.dir,
          outputFile: options.out,
        });
      } catch (error) {
        process.exit(1);
      }
    });

  // Subcomando => fk prisma watch
  prismaCmd
    .command("watch")
    .description("Observa cambios en tus módulos y auto-sincroniza Prisma")
    // El watcher necesita saber qué carpetas vigilar
    .option(
      "-b, --base <path>",
      "Ruta al archivo base de Prisma",
      "prisma/base.prisma",
    )
    .option("-d, --dir <path>", "Directorio a observar", "src")
    .option(
      "-o, --out <path>",
      "Ruta de salida del schema fusionado",
      "prisma/schema.prisma",
    )
    .action(async (options) => {
      try {
        await runPrismaWatch({
          baseFile: options.base,
          modelsDir: options.dir,
          outputFile: options.out,
        });
      } catch (error) {
        process.exit(1);
      }
    });
}
