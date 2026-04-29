import type { ListDir, ListFile } from "@fastify/static";

/**
 * @description Formatea bytes a una unidad legible (KB, MB, GB)
 */
function formatSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "--";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (
    Number.parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
  );
}

/**
 * @description Formatea un timestamp a fecha local legible
 */
function formatDate(timestamp?: number | string | Date): string {
  if (timestamp == null) return "--";
  const d = new Date(timestamp);
  return d.toLocaleDateString("es-ES", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * @description Escapa caracteres especiales para evitar ataques XSS en el HTML
 */
function escapeHtml(unsafe: string): string {
  return (unsafe ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * @description Sanitiza una URL para su uso seguro en atributos href
 */
function sanitizeHref(url: string): string {
  return escapeHtml(encodeURI(url ?? ""));
}

/**
 * @description Renderiza una interfaz HTML moderna para el listado de directorios de archivos estáticos.
 * Es consumida por @fastify/static cuando format es 'html'.
 */
export function renderDirectoryHtml(
  dirs: ListDir[],
  files: ListFile[],
): string {
  // Generamos el HTML para los directorios
  const dirsHtml = dirs
    .map((dir) => {
      const size = dir.extendedInfo?.totalSize;
      const lastModified = dir.extendedInfo?.lastModified;

      return `
        <tr>
          <td>
            <a href="${sanitizeHref(dir.href)}" class="item-link">
              <svg class="item-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path></svg>
              ${escapeHtml(dir.name)}
            </a>
          </td>
          <td class="meta-text">${dir.name === ".." ? "--" : formatSize(size)}</td>
          <td class="meta-text">${dir.name === ".." ? "--" : formatDate(lastModified)}</td>
        </tr>
      `;
    })
    .join("");

  // Generamos el HTML para los archivos
  const filesHtml = files
    .map((file) => {
      const size = file.stats?.size;
      const lastModified = file.stats?.mtime;

      return `
        <tr>
          <td>
            <a href="${sanitizeHref(file.href)}" target="_blank" class="item-link">
              <svg class="item-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
              ${escapeHtml(file.name)}
            </a>
          </td>
          <td class="meta-text">${formatSize(size)}</td>
          <td class="meta-text">${formatDate(lastModified)}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Explorador de Archivos | FastifyKit</title>
      <style>
        :root {
          --bg-app: #f8fafc;
          --bg-surface: #ffffff;
          --text-primary: #0f172a;
          --text-secondary: #64748b;
          --border-light: #e2e8f0;
          --hover-bg: #f1f5f9;
          --accent-color: #3b82f6;
          --radius-lg: 12px;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          background-color: var(--bg-app);
          color: var(--text-primary);
          line-height: 1.5;
          padding: 3rem 1.5rem;
          -webkit-font-smoothing: antialiased;
        }
        .app-container {
          max-width: 900px;
          margin: 0 auto;
          background: var(--bg-surface);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
          overflow: hidden;
        }
        .header {
          padding: 1.5rem 2rem;
          border-bottom: 1px solid var(--border-light);
          background: rgba(255, 255, 255, 0.8);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .header-icon { width: 24px; height: 24px; color: var(--accent-color); }
        .breadcrumb { font-size: 1.125rem; font-weight: 600; color: var(--text-primary); }
        .file-table { width: 100%; border-collapse: collapse; text-align: left; }
        .file-table th {
          padding: 0.875rem 2rem; font-size: 0.75rem; font-weight: 600;
          text-transform: uppercase; color: var(--text-secondary);
          background-color: #f8fafc; border-bottom: 1px solid var(--border-light);
        }
        .file-table td {
          padding: 1rem 2rem; border-bottom: 1px solid var(--border-light);
          font-size: 0.875rem; color: var(--text-secondary);
        }
        .file-table tr:hover td { background-color: var(--hover-bg); }
        .item-link {
          display: flex; align-items: center; gap: 1rem; color: var(--text-primary);
          text-decoration: none; font-weight: 500; transition: color 0.15s ease;
        }
        .item-link:hover { color: var(--accent-color); }
        .item-icon { width: 20px; height: 20px; color: var(--text-secondary); transition: transform 0.2s ease; }
        .item-link:hover .item-icon { color: var(--accent-color); transform: scale(1.1); }
        .meta-text { font-variant-numeric: tabular-nums; }
        .empty-state { padding: 3rem; text-align: center; color: var(--text-secondary); }
      </style>
    </head>
    <body>
      <div class="app-container">
        <div class="header">
          <svg class="header-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"></path></svg>
          <div class="breadcrumb">Explorador de Archivos</div>
        </div>
        <table class="file-table">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Tamaño</th>
              <th>Última Modificación</th>
            </tr>
          </thead>
          <tbody>
            ${dirs.length === 0 && files.length === 0 ? `<tr><td colspan="3"><div class="empty-state">Este directorio está vacío</div></td></tr>` : ""}
            ${dirsHtml}
            ${filesHtml}
          </tbody>
        </table>
      </div>
    </body>
    </html>
  `;
}
