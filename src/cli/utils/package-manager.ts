import fs from "node:fs/promises";

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

/**
 * @description Escanea el directorio especificado para detectar qué gestor de paquetes está utilizando el proyecto.
 * @param cwd El directorio donde buscar (por defecto process.cwd())
 */
export async function detectPackageManager(
  cwd = process.cwd(),
): Promise<PackageManager> {
  try {
    const files = await fs.readdir(cwd);
    if (files.includes("bun.lockb") || files.includes("bun.lock")) return "bun";
    if (files.includes("pnpm-lock.yaml")) return "pnpm";
    if (files.includes("yarn.lock")) return "yarn";
    return "npm"; // Fallback seguro
  } catch {
    return "npm";
  }
}

/**
 * @description Genera el comando de ejecución correcto (npx, bunx, pnpm dlx) según el gestor detectado.
 * @example await getRunnerCommand("prisma generate") // Retorna "bunx comando-a-ejecutar" si usas Bun
 */
export async function getRunnerCommand(
  command: string,
  cwd = process.cwd(),
): Promise<string> {
  const pm = await detectPackageManager(cwd);

  switch (pm) {
    case "bun":
      return `bunx ${command}`;
    case "pnpm":
      return `pnpm dlx ${command}`;
    case "yarn":
      return `yarn ${command}`;
    default:
      return `npx ${command}`;
  }
}
