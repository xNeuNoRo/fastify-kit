import type { DistributedCacheOptions } from "./cache.interface.js";

/**
 * @description Opciones de conexión a Redis compartidas por todas las funcionalidades
 * distribuidas de FastifyKit (EventBus, colas BullMQ, caché L2).
 */
export interface RedisConnectionOptions {
  host?: string;
  port?: number;
  password?: string;
  username?: string;
  db?: number;
}

/**
 * @description Configuración para las funcionalidades distribuidas del framework.
 * Permite escalar horizontalmente la aplicación utilizando un backend de almacenamiento compartido.
 */
export interface DistributedOptions {
  /**
   * Configuración de conexión a Redis.
   * Proveer esta configuración habilita la CAPACIDAD de usar características avanzadas
   * (EventBus global, colas distribuidas, caché L2), pero cada característica debe activarse
   * explícitamente en `features`. La presencia de Redis por sí sola no activa nada.
   */
  redis?: RedisConnectionOptions;
  /**
   * Configuración granular de las características distribuidas a habilitar.
   */
  features?: {
    /**
     * Habilita el EventBus distribuido mediante Redis Pub/Sub.
     * Es obligatorio activarlo si se utiliza la estrategia de colas 'redis'.
     */
    eventBus?: boolean;
    /**
     * Habilita la caché distribuida (L1 en memoria y/o L2 en Redis).
     * Los modos "l2-only" y "multi" requieren `distributed.redis`.
     * Sin esta opción, la caché opera en modo "l1-only" (solo memoria local).
     */
    cache?: DistributedCacheOptions;
  };
}
