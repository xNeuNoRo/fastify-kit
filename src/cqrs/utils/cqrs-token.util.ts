import { Constructor } from "../../http/routing/scanner/index.js";

/**
 * @description Genera un token único y consistente para registrar y resolver
 * manejadores de CQRS en el contenedor de Inyección de Dependencias.
 * @param requestClass La clase del Comando o Query (el constructor).
 * @returns El token de resolución (symbol).
 * @remarks Esto ya se utiliza de forma interna en los decoradores \@CommandHandler y \@QueryHandler,
 * por lo que no es necesario usarlo directamente a menos que quieras registrar o resolver
 * handlers de CQRS manualmente en el contenedor.
 */
export const getCqrsHandlerToken = (requestClass: Constructor): symbol => {
  if (!requestClass?.name) {
    throw new Error(
      "[FastifyKit CQRS] No se pudo generar un token: La clase proporcionada no es válida.",
    );
  }
  return Symbol.for(`CQRS_HANDLER_${requestClass.name}`);
};
