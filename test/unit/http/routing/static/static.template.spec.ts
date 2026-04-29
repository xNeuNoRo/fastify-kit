import { describe, it, expect } from "vitest";

import { renderDirectoryHtml } from "../../../../../src/http/routing/scanner/static/static.template.js";

describe("Generador de Plantillas HTML Estaticas", () => {
  it("Deberia renderizar el HTML correctamente formateando bytes y fechas", () => {
    const dirs = [
      {
        name: "images",
        href: "/public/images",
        extendedInfo: {
          totalSize: 1048576, // Exactamente 1 MB
          lastModified: new Date("2026-04-28T12:00:00Z").getTime(),
        },
      },
    ];
    const files = [
      {
        name: "logo.png",
        href: "/public/logo.png",
        stats: {
          size: 512000, // Aproximadamente 500 KB
          mtime: new Date("2026-04-28T12:00:00Z").getTime(),
        },
      },
    ];

    const html = renderDirectoryHtml(dirs, files);

    // Verificamos que los elementos existan
    expect(html).toContain("Explorador de Archivos");
    expect(html).toContain("images");
    expect(html).toContain("logo.png");

    // Verificamos las funciones matemáticas internas de formateo
    expect(html).toContain("1 MB");
    expect(html).toContain("500 KB");
  });

  it("Deberia mostrar el estado vacío si no hay archivos ni directorios", () => {
    const html = renderDirectoryHtml([], []);
    expect(html).toContain("Este directorio está vacío");
  });
});
