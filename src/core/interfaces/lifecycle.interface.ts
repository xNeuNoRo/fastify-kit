/**
 * Se ejecuta una vez que todos los módulos y dependencias han sido resueltos por el DI Container,
 * pero ANTES de que el servidor HTTP comience a escuchar peticiones.
 * Ideal para establecer conexiones a bases de datos o configuraciones iniciales.
 */
export interface OnModuleInit {
  onModuleInit(): Promise<void> | void;
}

/**
 * Se ejecuta una vez que la aplicación entera ha arrancado y todos los controladores/gateways
 * están registrados, justo antes de enlazarse al puerto de red.
 */
export interface OnApplicationBootstrap {
  onApplicationBootstrap(): Promise<void> | void;
}

/**
 * Se ejecuta estrictamente DESPUÉS de que el servidor HTTP ya está escuchando en el puerto.
 * Ideal para loguear la URL del servidor o notificar a un Service Discovery externo.
 */
export interface OnServerReady {
  onServerReady(): Promise<void> | void;
}

/**
 * Se ejecuta inmediatamente cuando se recibe una señal de terminación (SIGTERM/SIGINT),
 * pero ANTES de que el servidor HTTP deje de aceptar nuevas peticiones.
 * Perfecto para sacar el nodo de un Load Balancer (Draining) en Kubernetes/Railway.
 * @param signal La señal del sistema que disparó el apagado (ej. 'SIGTERM').
 */
export interface BeforeApplicationShutdown {
  beforeApplicationShutdown(signal?: string): Promise<void> | void;
}

/**
 * Se ejecuta cuando la aplicación se está apagando activamente.
 * Perfecto para un cierre elegante (Graceful Shutdown), cerrar pools de bases de datos o limpiar timers.
 * @param signal La señal del sistema que disparó el apagado (ej. 'SIGTERM').
 */
export interface OnApplicationShutdown {
  onApplicationShutdown(signal?: string): Promise<void> | void;
}
