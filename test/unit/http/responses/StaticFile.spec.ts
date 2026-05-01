import { describe, it, expect } from "vitest";

import { StaticFile } from "../../../../src/http/responses/StaticFile.js";

describe("Clase StaticFile", () => {
  it("Deberia instanciar correctamente asignando el nombre y las opciones", () => {
    const options = {
      root: "/secure/docs",
      attachment: true,
      fallback: "error.pdf",
    };
    const file = new StaticFile("report.pdf", options);

    expect(file.filename).toBe("report.pdf");
    expect(file.options.root).toBe("/secure/docs");
    expect(file.options.attachment).toBe(true);
    expect(file.options.fallback).toBe("error.pdf");
  });
});
