const configStore = new Map<string, any>();

export class ConfigRegistry {
  /**
   * @description Registra una configuración bajo un namespace específico en el ConfigRegistry. Esto permite organizar y acceder a configuraciones de manera centralizada en la aplicación, facilitando su gestión y evitando la dispersión de configuraciones en diferentes partes del código. Al registrar una configuración, se asocia un namespace único con un objeto de configuración, lo que permite acceder a esa configuración posteriormente utilizando el mismo namespace. Esta función es especialmente útil para mantener las configuraciones organizadas y fácilmente accesibles en toda la aplicación.
   * @param namespace El namespace bajo el cual se desea registrar la configuración. Este debe ser un string único que identifique claramente la configuración que se está registrando, evitando colisiones con otros namespaces.
   * @param config El objeto de configuración que se desea registrar bajo el namespace especificado. Este objeto puede contener cualquier tipo de datos relacionados con la configuración, como opciones, parámetros, credenciales, etc. Es importante asegurarse de que el objeto de configuración esté estructurado de manera clara y coherente para facilitar su uso posterior.
   * @example
   * ```typescript
   * // Registrando una configuración de base de datos bajo el namespace "database"
   * ConfigRegistry.set("database", {
   *   host: "localhost",
   *   port: 5432,
   *   username: "user",
   *   password: "password",
   * });
   *
   * // Tambien puedes inyectarla en el paradigma orientado a objetos usando el decorador @InjectConfig
   * class MyService {
   *   @InjectConfig("database")
   *   private readonly dbConfig: DatabaseConfig;
   * }
   */
  static set(namespace: string, config: any) {
    configStore.set(namespace, config);
  }

  /**
   * @description Obtiene la configuración registrada bajo un namespace específico en el ConfigRegistry. Esta función permite acceder a las configuraciones de manera centralizada utilizando el namespace asociado a cada configuración. Al solicitar una configuración por su namespace, se devuelve el objeto de configuración correspondiente si existe, o undefined si no se ha registrado ninguna configuración bajo ese namespace. Es importante asegurarse de que el namespace utilizado para obtener la configuración coincida exactamente con el namespace utilizado al registrarla para garantizar que se recupere la configuración correcta.
   * @param namespace El namespace de la configuración que se desea obtener. Este debe ser un string que identifique claramente la configuración que se está buscando, y debe coincidir exactamente con el namespace utilizado al registrar la configuración.
   * @returns El objeto de configuración registrado bajo el namespace especificado, o undefined si no se ha registrado ninguna configuración bajo ese namespace.
   * @example
   * ```typescript
   * // Obteniendo la configuración de base de datos registrada bajo el namespace "database"
   * const dbConfig = ConfigRegistry.get("database");
   * console.log(dbConfig); // Imprime el objeto de configuración de la base de datos
   * 
   * // Tambien puedes inyectarla en el paradigma orientado a objetos usando el decorador @InjectConfig
   * class MyService {
   *   @InjectConfig("database")
   *   private readonly dbConfig: DatabaseConfig;
   * }
   */
  static get<T>(namespace: string): T | undefined {
    return configStore.get(namespace) as T;
  }
}
