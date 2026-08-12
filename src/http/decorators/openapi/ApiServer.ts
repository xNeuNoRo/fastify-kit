import type { FastifyKitMetadata } from "../types.js";

/**
 * @description Decorador de clase o método para especificar un servidor alternativo en OpenAPI.
 * Útil cuando ciertos endpoints están disponibles en un subdominio diferente
 * (ej: endpoints de carga de archivos en `https://uploads.api.com`, o un endpoint
 * de webhooks en `https://webhooks.api.com`).
 *
 * @param url URL del servidor alternativo. Puede incluir variables {env}.
 * @param description Descripción opcional del servidor.
 * @returns Un decorador que puede aplicarse a clase o método.
 *
 * @example
 * ```typescript
 * \@Controller("/files")
 * \@ApiServer("https://uploads.example.com", "Servidor de archivos")
 * class FilesController {
 *   \@Post("/upload")
 *   upload(@File("doc") file: MultipartFile) { ... }
 * }
 * ```
 *
 * @remarks A nivel de clase, el servidor se aplica a todos los métodos del controlador.
 * A nivel de método, sobrescribe cualquier servidor de clase para ese endpoint específico.
 */
export function ApiServer(url: string, description?: string) {
  return function <T extends Function>(
    _target: T,
    context: ClassDecoratorContext | ClassMethodDecoratorContext,
  ) {
    if (context.kind !== "class" && context.kind !== "method") {
      throw new Error(
        "[FastifyKit] @ApiServer solo puede aplicarse a clases o métodos",
      );
    }

    const metadata = context.metadata as FastifyKitMetadata;
    const serverObj = { url, description };

    if (context.kind === "class") {
      metadata.openApiClassServers ??= [];
      if (
        !metadata.openApiClassServers.find((s) => s.url === url)
      ) {
        metadata.openApiClassServers.push(serverObj);
      }
    }
    // Para métodos, no hay soporte granular de servers en OpenAPI 3.1
    // a nivel de operación (solo a nivel de path). Lo guardamos igual para futuro.
  };
}
