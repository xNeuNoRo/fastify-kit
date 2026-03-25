import { FastifyKitMetadata, RateLimitOptions } from "./types";

/**
 * @description Decorador para aplicar rate limiting a un método de controlador específico. Permite configurar el número máximo de solicitudes permitidas dentro de una ventana de tiempo, cuánto tiempo debe durar esa ventana, cuántas veces puede excederse el límite antes de ser bloqueado totalmente, si debe seguir contando incluso tras el bloqueo, y una lista de IPs o identificadores que están exentos del rate limit.
 * @param options Opciones de configuración para el rate limiting, incluyendo:
 * - `max`: El número máximo de solicitudes permitidas dentro de la ventana de tiempo.
 * - `timeWindow`: La duración de la ventana de tiempo en milisegundos (Ej: 60000 para 1 minuto).
 * - `ban`: Cuántas veces puede excederse el límite antes de ser bloqueado totalmente (opcional).
 * - `continueExceeding`: Si debe seguir contando incluso tras el bloqueo (opcional).
 * - `allowList`: Lista de IPs o identificadores que están exentos del rate limit (opcional).
 * @example
 * \@RateLimit({ max: 100, timeWindow: "1m" })
 * async getBooks() {
 *   // Este método solo permitirá 100 solicitudes por minuto desde la misma IP o identificador,
 *   // a menos que se exceda el límite de ban configurado, en cuyo caso bloqueará totalmente.
 * }
 * @returns Un decorador de método que aplica la configuración de rate limiting a la ruta correspondiente.
 */
export function RateLimit(options: RateLimitOptions) {
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    if (context.kind !== "method") {
      throw new Error(
        "[FastifyKit] @RateLimit solo puede aplicarse a métodos.",
      );
    }

    const metadata = context.metadata as FastifyKitMetadata;
    metadata.rateLimits ??= {};
    metadata.rateLimits[context.name] = options;
  };
}
