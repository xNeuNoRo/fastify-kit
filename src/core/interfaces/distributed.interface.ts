/**
 * @description Configuración para las funcionalidades distribuidas del framework.
 * Permite escalar horizontalmente la aplicación utilizando un backend de almacenamiento compartido.
 */
export interface DistributedOptions {
  /**
   * Configuración de conexión a Redis.
   * Al proveer esta configuración, habilitas características avanzadas como el EventBus global
   * y las colas distribuidas (si activas la estrategia 'redis' en las opciones de colas).
   */
  redis?: {
    host?: string;
    port?: number;
    password?: string;
    username?: string;
    db?: number;
  };
  /**
   * Configuración granular de las características distribuidas a habilitar.
   */
  features?: {
    /**
     * Habilita el EventBus distribuido mediante Redis Pub/Sub.
     * Es obligatorio activarlo si se utiliza la estrategia de colas 'redis'.
     */
    eventBus?: boolean;
  };
}
