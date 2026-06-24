/**
 * @description Token para inyectar el ConfigService en el contenedor DI.
 * Usa este token para acceder a configuraciones de usuario (PORT, DATABASE_URL, etc.).
 * Para config interna del framework usa INTERNAL_CONFIG_SERVICE_TOKEN.
 */
export const CONFIG_SERVICE_TOKEN = Symbol.for("CONFIG_SERVICE_TOKEN");

/**
 * @description Contrato para el servicio de configuración de usuario.
 * Gestiona configuraciones genéricas bajo namespaces de string (PORT, DATABASE_URL, etc.).
 * Registrado por ConfigModule.forRoot() y resuelto por @InjectConfig.
 *
 * Para configuración interna del framework (queue, distributed, webrtc),
 * usa InternalConfigService con el token INTERNAL_CONFIG_SERVICE_TOKEN.
 */
export interface ConfigService {
  /**
   * Registra una configuración de usuario bajo un namespace.
   * @param namespace El namespace de la configuración (ej: "DATABASE_URL", "PORT").
   * @param value El valor de la configuración.
   */
  setConfig<T>(namespace: string, value: T): void;

  /**
   * Obtiene una configuración de usuario por su namespace.
   * @param namespace El namespace de la configuración.
   * @returns La configuración solicitada, o undefined si no existe.
   */
  getConfig<T>(namespace: string): T | undefined;

  /**
   * Verifica si existe una configuración de usuario bajo un namespace.
   * @param namespace El namespace de la configuración.
   * @returns true si la configuración existe, false en caso contrario.
   */
  hasConfig(namespace: string): boolean;

  /**
   * Elimina todas las configuraciones de usuario.
   */
  clear(): void;
}
