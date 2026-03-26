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
   * // Tambien puedes inyectarla en el paradigma orientado a objetos usando el decorador \@InjectConfig
   * class MyService {
   *   \@InjectConfig("database")
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
   * // Tambien puedes inyectarla en el paradigma orientado a objetos usando el decorador \@InjectConfig
   * class MyService {
   *   \@InjectConfig("database")
   *   private readonly dbConfig: DatabaseConfig;
   * }
   */
  static get<T>(namespace: string): T | undefined {
    return configStore.get(namespace) as T;
  }

  /**
   * @description Verifica si existe una configuración registrada bajo un namespace específico en el ConfigRegistry. Esta función es útil para determinar si una configuración ha sido registrada antes de intentar acceder a ella, lo que puede ayudar a evitar errores o comportamientos inesperados en la aplicación. Al verificar la existencia de una configuración por su namespace, se devuelve true si la configuración existe y false si no se ha registrado ninguna configuración bajo ese namespace. Es importante asegurarse de que el namespace utilizado para verificar la existencia de la configuración coincida exactamente con el namespace utilizado al registrarla para obtener resultados precisos.
   * @param namespace El namespace de la configuración que se desea verificar. Este debe ser un string que identifique claramente la configuración que se está buscando, y debe coincidir exactamente con el namespace utilizado al registrar la configuración.
   * @returns true si existe una configuración registrada bajo el namespace especificado, o false si no se ha registrado ninguna configuración bajo ese namespace.
   * @example
   * ```typescript
   * // Verificando si existe una configuración de base de datos registrada bajo el namespace "database"
   * const hasDbConfig = ConfigRegistry.has("database");
   * console.log(hasDbConfig); // Imprime true si la configuración existe, o false si no existe
   *
   * // Tambien puedes inyectarla en el paradigma orientado a objetos usando el decorador \@InjectConfig
   * class MyService {
   *   \@InjectConfig("database")
   *   private readonly dbConfig: DatabaseConfig;
   * }
   *
   * // Verificando si la configuración inyectada en MyService existe
   * const myService = new MyService();
   * const hasDbConfigInMyService = myService.dbConfig !== undefined;
   * console.log(hasDbConfigInMyService); // Imprime true si la configuración existe, o false si no existe
   * ```
   */
  static has(namespace: string): boolean {
    return configStore.has(namespace);
  }

  /**
   * @description Elimina la configuración registrada bajo un namespace específico en el ConfigRegistry. Esta función es útil para eliminar configuraciones que ya no son necesarias o para limpiar configuraciones específicas sin afectar otras configuraciones registradas en el mismo registro. Al eliminar una configuración por su namespace, se borra completamente la asociación entre ese namespace y el objeto de configuración registrado, lo que significa que la configuración ya no estará disponible para su acceso posterior utilizando ese namespace. Es importante asegurarse de que el namespace utilizado para eliminar la configuración coincida exactamente con el namespace utilizado al registrarla para garantizar que se elimine la configuración correcta.
   * @param namespace El namespace de la configuración que se desea eliminar. Este debe ser un string que identifique claramente la configuración que se está buscando eliminar, y debe coincidir exactamente con el namespace utilizado al registrar la configuración.
   * @returns true si la configuración fue eliminada exitosamente, o false si no se encontró ninguna configuración bajo ese namespace.
   * @example
   * ```typescript
   * // Eliminando la configuración de base de datos registrada bajo el namespace "database"
   * const wasDeleted = ConfigRegistry.delete("database");
   * console.log(wasDeleted); // Imprime true si la configuración fue eliminada, o false si no se encontró ninguna configuración bajo ese namespace
   *
   * // Tambien puedes inyectarla en el paradigma orientado a objetos usando el decorador \@InjectConfig
   * class MyService {
   *   \@InjectConfig("database")
   *   private readonly dbConfig: DatabaseConfig;
   * }
   *
   * // Eliminando la configuración inyectada en MyService
   * const myService = new MyService();
   * const wasDeletedInMyService = ConfigRegistry.delete("database");
   * console.log(wasDeletedInMyService); // Imprime true si la configuración fue eliminada, o false si no se encontró ninguna configuración bajo ese namespace
   * ```
   */
  static delete(namespace: string): boolean {
    return configStore.delete(namespace);
  }

  /**
   * @description Elimina todas las configuraciones registradas en el ConfigRegistry. Esta función es útil para limpiar el registro de configuraciones, especialmente durante pruebas o cuando se desea reiniciar la configuración de la aplicación. Al llamar a esta función, se borra completamente el almacenamiento interno de configuraciones, lo que significa que todas las configuraciones previamente registradas ya no estarán disponibles y deberán ser registradas nuevamente si se necesitan en el futuro.
   * @example
   * ```typescript
   * // Limpiando todas las configuraciones registradas en el ConfigRegistry
   * ConfigRegistry.clear();
   *
   * // Después de llamar a clear, todas las configuraciones anteriores ya no estarán disponibles
   * const dbConfig = ConfigRegistry.get("database");
   * console.log(dbConfig); // Imprime undefined, ya que la configuración ha sido eliminada
   *
   * // Tambien puedes inyectarla en el paradigma orientado a objetos usando el decorador \@InjectConfig
   * class MyService {
   *   \@InjectConfig("database")
   *   private readonly dbConfig: DatabaseConfig;
   * }
   *
   * // Después de llamar a clear, la configuración inyectada en MyService ya no estará disponible
   * const myService = new MyService();
   * console.log(myService.dbConfig); // Imprime undefined, ya que la configuración ha sido eliminada
   * ```
   */
  public clear(): void {
    configStore.clear();
  }
}
