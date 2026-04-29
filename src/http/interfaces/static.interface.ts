/**
 * @description Opciones para servir un directorio completo de archivos estáticos.
 * Estas opciones se utilizan en el decorador @StaticAssets().
 */
export interface StaticAssetsOptions {
  /**
   * Directorio físico y absoluto donde se encuentran los archivos.
   * @example path.join(process.cwd(), 'public')
   */
  root: string;

  /**
   * Prefijo de la URL para servir los archivos.
   * En controladores, por defecto usa el prefijo del @Controller.
   * En configuración global, por defecto es 'public'.
   */
  prefix?: string;

  /**
   * Configuración de caché para el navegador.
   * - 'aggressive': 1 año (365d) e inmutable. Ideal para archivos con hash en el nombre.
   * - 'standard': 1 mes (30d). Balance ideal para la mayoría de los assets.
   * - 'medium': 1 semana (7d). Útil para recursos que se actualizan con cierta frecuencia.
   * - 'short': 1 día (24h). Para contenido muy volátil.
   * - 'none': Desactiva el cache (Cache-Control: no-store).
   * - Object: Control total manual.
   */
  cache?:
    | "aggressive"
    | "standard"
    | "medium"
    | "short"
    | "none"
    | { maxAge: string | number; immutable?: boolean };

  /**
   * Permite servir archivos y carpetas ocultas (que empiezan por un punto).
   * Útil para exponer carpetas como '.well-known'.
   * @default false
   */
  serveDotFiles?: boolean;

  /**
   * Nombre del archivo por defecto a servir cuando se accede a la raíz de una carpeta.
   * Si se establece en false, se desactiva esta funcionalidad.
   * @example "index.html"
   */
  index?: string | string[] | false;

  /**
   * Oculta las rutas estáticas de la documentación de Swagger/Scalar para mantener la API limpia.
   * @default true
   */
  hideFromDocs?: boolean;

  /**
   * Genera un índice visual o JSON de los archivos contenidos en el directorio.
   * Si se pasa un objeto, permite activar información extendida (peso, fecha, etc).
   */
  listDirectory?:
    | boolean
    | { format?: "json" | "html"; extendedInfo?: boolean };

  /**
   * Habilita la entrega automática de archivos pre-comprimidos (.gz, .br)
   * si el navegador del cliente lo soporta, ahorrando ancho de banda.
   * @default false
   */
  compress?: boolean;

  /**
   * Lista blanca de extensiones permitidas. Si se define, cualquier archivo
   * que no termine en alguna de estas extensiones será bloqueado (403/404).
   * Útil para prevenir Path Traversal en carpetas de uploads.
   * @example ['.jpg', '.png', '.webp']
   */
  allowedExtensions?: string[];

  /**
   * Si es true, inyecta la cabecera 'Content-Disposition: attachment' a todos
   * los archivos servidos desde este directorio, forzando su descarga.
   * @default false
   */
  forceDownload?: boolean;

  /**
   * Protección Anti-Hotlinking. Lista de dominios permitidos en la cabecera 'Referer'.
   * Si una petición proviene de un dominio que no está en esta lista, será rechazada.
   * @example ['https://nuestra-plataforma.com', 'http://localhost:3000']
   */
  validReferers?: string[];

  /**
   * Objeto con cabeceras HTTP personalizadas que se inyectarán en cada respuesta.
   * Útil para configurar políticas de caché estrictas o CORS localizado.
   * @example { 'Cache-Control': 'public, max-age=86400' }
   */
  headers?: Record<string, string>;
}

/**
 * @description Opciones para servir un archivo estático individual y protegido.
 */
export interface StaticFileOptions {
  /**
   * Directorio base donde buscar el archivo a servir.
   */
  root: string;

  /**
   * Si es true, obliga al navegador a abrir la ventana de descarga en lugar
   * de intentar visualizar el archivo en la pestaña actual.
   * @default false
   */
  attachment?: boolean;

  /**
   * Nombre de archivo personalizado que verá el usuario al descargar,
   * ocultando el nombre real que tiene en el disco duro.
   * @example "Reporte_Financiero_2026.pdf"
   */
  customName?: string;

  /**
   * Nombre del archivo de respaldo que se servirá si el archivo principal no existe.
   * Excelente para devolver una imagen por defecto en caso de errores 404.
   * @example "default-avatar.png"
   */
  fallback?: string;
}
