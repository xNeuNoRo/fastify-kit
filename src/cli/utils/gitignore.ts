import fs from "node:fs/promises";
import path from "node:path";

/**
 * Busca el archivo .gitignore escalando hacia arriba en los directorios.
 * Ideal para soportar Monorepos donde el .gitignore está en la raíz global.
 */
async function findNearestGitIgnore(currentDir: string): Promise<string> {
  let dir = currentDir;

  while (true) {
    const checkPath = path.join(dir, ".gitignore");
    try {
      // Intentamos acceder al archivo
      await fs.access(checkPath);
      return checkPath; // Si no lanza error, lo encontramos
    } catch {
      const parentDir = path.dirname(dir);
      // Si llegamos a la raíz del disco duro (ej. / o C:\) y no lo encontramos
      if (parentDir === dir) {
        // Retornamos la ruta original para que se cree un .gitignore nuevo ahí
        return path.join(currentDir, ".gitignore");
      }
      // Subimos un nivel y seguimos buscando
      dir = parentDir;
    }
  }
}

/**
 * Añade una entrada al .gitignore del proyecto si no existe.
 * Escala inteligentemente para soportar monorepos.
 * @param entry La ruta o patrón a ignorar (ej. "prisma/schema.prisma")
 * @param comment Comentario opcional para organizar el .gitignore
 */
export async function ensureGitIgnore(
  entry: string,
  comment = "FastifyKit Auto-Generated",
) {
  const cwd = process.cwd();
  const gitignorePath = await findNearestGitIgnore(cwd);

  // Como el .gitignore podría estar más arriba (ej. en un monorepo),
  // necesitamos calcular la ruta relativa desde el .gitignore hasta nuestro archivo.
  const absoluteEntryPath = path.resolve(cwd, entry);
  const gitignoreDir = path.dirname(gitignorePath);
  let relativeEntry = path.relative(gitignoreDir, absoluteEntryPath);

  // En Git, los paths siempre usan "/" sin importar el sistema operativo
  const normalizedEntry = relativeEntry.replaceAll("\\", "/");

  try {
    const content = await fs.readFile(gitignorePath, "utf-8");

    if (!content.includes(normalizedEntry)) {
      await fs.appendFile(
        gitignorePath,
        `\n# ${comment}\n${normalizedEntry}\n`,
      );
    }
  } catch (e) {
    // Si falla la lectura, asumimos que no existe y lo creamos en el CWD
    await fs.writeFile(gitignorePath, `# ${comment}\n${normalizedEntry}\n`);
  }
}
