/**
 * @description Token de inyección de dependencias para la conexión compartida de Redis.
 *
 * Vive en un módulo SIN imports de runtime para que el root del paquete pueda
 * reexportarlo sin cargar 'ioredis' (peer opcional). Los consumidores que solo
 * necesitan el token lo importan desde aquí; el cliente ioredis se carga
 * dinámicamente solo cuando se activa una feature distribuida.
 */
export const REDIS_CONNECTION_TOKEN = Symbol.for("REDIS_CONNECTION_TOKEN");
