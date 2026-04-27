import { Command } from "commander";
import { registerPrismaCommands } from "./commands/prisma/index.js";

// Iniciamos el programa de comandos (CLI) usando Commander
const program = new Command();

program
  .name("fk")
  .description("FastifyKit CLI - Herramientas de desarrollo para FastifyKit")
  .version("0.6.7");

// Registramos los comandos relacionados con Prisma
registerPrismaCommands(program);

// Este método es el que atrapa los argumentos de la terminal (process.argv)
// y ejecuta la lógica correspondiente.
program.parse(process.argv);

// Si el usuario escribe solo "fk" sin comandos, le mostramos la ayuda automáticamente
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
