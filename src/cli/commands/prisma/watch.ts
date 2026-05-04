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
  const watcher = chokidar.watch(modelsDir, {
    persistent: true,
    ignoreInitial: true, // Ya hicimos el sync inicial manualmente
  });

  console.log(
    pc.cyan(
      `${pc.gray("[FK CLI]")} Observando cambios en: ${pc.bold(modelsDir)}/**/*.prisma\n`,
    ),
  );

  // Manejamos los eventos de cambio con un debounce para evitar múltiples ejecuciones seguidas
  let timeoutId: NodeJS.Timeout | null = null;
  let isSyncing = false;
  let pendingSync = false;

  // Función para ejecutar la sincronización con control de concurrencia
  const executeSync = async () => {
    // Si ya estamos sincronizando, marcamos que hay una sincronización pendiente y salimos
    if (isSyncing) {
      pendingSync = true;
      return;
    }

    // Marcamos que estamos sincronizando para evitar ejecuciones concurrentes
    isSyncing = true;

    // Ejecutamos la sincronización y manejamos errores para que el watcher siga activo
    try {
      await runPrismaSync(options);
    } catch {
      console.log(
        pc.yellow(
          `${pc.gray("[FK CLI]")} El watcher sigue activo. Corrige el error en tus modelos y guarda para reintentar.\n`,
        ),
      );
    } finally {
      // Marcamos que ya no estamos sincronizando
      isSyncing = false;
      // Si durante la sincronización se marcó que hay una sincronización pendiente, la ejecutamos inmediatamente
      if (pendingSync) {
        pendingSync = false;
        executeSync();
      }
    }
  };

  // Función para manejar los eventos de cambio con debounce
  const handleChange = (path: string, type: string) => {
    // Solo reaccionamos a cambios en archivos .prisma para evitar ejecuciones innecesarias
    if (!path.endsWith(".prisma")) return;

    console.log(
      `${pc.gray("[FK CLI]")} ${pc.yellow(" [MODIFICADO] ")} ${pc.gray(type)}: ${path}`,
    );

    // Si ya hay un timeout pendiente, lo limpiamos para reiniciar el conteo
    if (timeoutId) clearTimeout(timeoutId);

    // Establecemos un nuevo timeout para ejecutar la sincronización después de 300ms sin cambios adicionales
    timeoutId = setTimeout(executeSync, 300);
  };

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
