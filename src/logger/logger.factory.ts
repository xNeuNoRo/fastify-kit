import { container, type Contract } from "../container/DIContainer";
import {
  DefaultConsoleLogger,
  LOGGER_TOKEN,
  LoggerContract,
} from "./LoggerContract";

let fallbackLogger: LoggerContract | null = null;

/**
 * @description Factory para obtener una instancia del logger.
 * @returns Una instancia de LoggerContract, ya sea la registrada en el contenedor de dependencias o una implementación por defecto si no se ha registrado ninguna.
 */
export function getLogger(): LoggerContract {
  try {
    return container.resolve<LoggerContract>(
      LOGGER_TOKEN as unknown as Contract<LoggerContract>,
    );
  } catch (error) {
    fallbackLogger ??= new DefaultConsoleLogger();
    fallbackLogger.warn(
      "[FastifyKit Logger] No se pudo resolver una instancia de LoggerContract desde el contenedor de dependencias. Se está utilizando el logger por defecto. Asegúrate de registrar una implementación de LoggerContract en el contenedor para obtener funcionalidades completas de logging.",
      { error: (error as Error).message },
    );
    return fallbackLogger;
  }
}
