import { Command } from "commander";
import { runPrismaSync } from "./sync.js";

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
    .action(async () => {
      await runPrismaSync();
    });

  // Subcomando => fk prisma watch
  prismaCmd
    .command("watch")
    .description("Observa cambios en tus módulos y auto-sincroniza Prisma")
    .action(() => {
      console.log("Pendiente xd");
    });
}
