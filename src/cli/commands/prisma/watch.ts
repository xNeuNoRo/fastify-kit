import chokidar from "chokidar";
import pc from "picocolors";
import { runPrismaSync, type PrismaSyncOptions } from "./sync.js";

/**
 * Inicia un observador en tiempo real para los archivos .prisma de los dominios.
 */
export async function runPrismaWatch(options: PrismaSyncOptions = {}) {
  const modelsDir = options.modelsDir || "src";

  // Realizamos una sincronización inicial para asegurar que el esquema esté listo antes de empezar a observar
  console.log(
    pc.blue(`\n${pc.gray("[FK CLI]")} Iniciando modo watch para Prisma...`),
  );
  await runPrismaSync(options);

  // Configuramos chokidar para vigilar solo archivos .prisma dentro del directorio de modelos
  const watcher = chokidar.watch(`${modelsDir}/**/*.prisma`, {
    persistent: true,
    ignoreInitial: true, // Ya hicimos el sync inicial manualmente
  });

  console.log(
    pc.cyan(
      `${pc.gray("[FK CLI]")} Observando cambios en: ${pc.bold(modelsDir)}/**/*.prisma\n`,
    ),
  );

  // Definimos qué hacer cuando algo cambie
  const handleChange = async (path: string, type: string) => {
    console.log(
      `${pc.gray("[FK CLI]")} ${pc.yellow(" [MODIFICADO] ")} ${pc.gray(type)}: ${path}`,
    );

    try {
      await runPrismaSync(options);
    } catch {
      console.log(
        pc.yellow(
          `${pc.gray("[FK CLI]")} El watcher sigue activo. Corrige el error en tus modelos y guarda para reintentar.\n`,
        ),
      );
    }
  };

  // Configuramos los eventos que queremos escuchar
  watcher
    .on("add", (path) => handleChange(path, "Archivo creado"))
    .on("change", (path) => handleChange(path, "Archivo editado"))
    .on("unlink", (path) => handleChange(path, "Archivo eliminado"));

  // Manejamos la salida limpia del proceso para cerrar el watcher correctamente
  process.on("SIGINT", () => {
    // Cerramos el watcher antes de salir para liberar recursos
    watcher.close();
    // Salimos del proceso con código 0 (éxito)
    process.exit(0);
  });
}
