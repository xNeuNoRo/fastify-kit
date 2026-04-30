// Contrato para el logger, define los métodos que cualquier implementación de logger debe tener.
export interface LoggerContract {
  info(message: string, context?: Record<string, any>): void;
  warn(message: string, context?: Record<string, any>): void;
  error(message: string, context?: Record<string, any>): void;
  debug(message: string, context?: Record<string, any>): void;
  fatal(message: string, context?: Record<string, any>): void;
}

// Token para inyección de dependencias, permite identificar el logger en el contenedor de dependencias.
// Symbol es un tipo de dato primitivo que garantiza que sea único, ideal para tokens de inyección de dependencias.
export const LOGGER_TOKEN = Symbol.for("LOGGER_TOKEN");

// Implementación por defecto del logger
// que utiliza la consola del navegador o Node.js para mostrar los mensajes.
export class DefaultConsoleLogger implements LoggerContract {
  info(msg: string, ctx?: any) {
    console.info(`🔵 [INFO]: ${msg}`, ctx || "");
  }
  warn(msg: string, ctx?: any) {
    console.warn(`🟠 [WARN]: ${msg}`, ctx || "");
  }
  error(msg: string, ctx?: any) {
    console.error(`🔴 [ERROR]: ${msg}`, ctx || "");
  }
  debug(msg: string, ctx?: any) {
    console.debug(`🟣 [DEBUG]: ${msg}`, ctx || "");
  }
  fatal(msg: string, ctx?: any) {
    console.error(`💥 [FATAL]: ${msg}`, ctx || "");
  }
}
