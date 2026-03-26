import type { FastifyKitMetadata } from "./types.js";

/**
 * @description Define la versión de la API para un controlador completo o un método específico.
 * @param version El número o string de la versión (ej: "1", "2", "beta").
 */
export function Version(version: string) {
  return function <T extends Function>(
    _target: T,
    context: ClassDecoratorContext | ClassMethodDecoratorContext,
  ) {
    // Validamos que el decorador se aplique solo a clases o métodos
    if (context.kind !== "class" && context.kind !== "method") {
      throw new Error(
        "[FastifyKit] @Version solo puede ser aplicado a clases o métodos de clase",
      );
    }

    // Extendemos la metadata del decorador para incluir la versión,
    // ya sea a nivel de clase o método, dependiendo del contexto en el que se aplique el decorador.
    const metadata = context.metadata as FastifyKitMetadata;

    // Si el decorador se aplica a una clase, asignamos la versión a la metadata de la clase.
    if (context.kind === "class") {
      metadata.version = version;
    }
    // Si el decorador se aplica a un método, asignamos la versión a la metadata
    // del método específico, mapeada por el nombre del método.
    else if (context.kind === "method") {
      metadata.methodVersions = metadata.methodVersions || {};
      metadata.methodVersions[context.name] = version;
    }
  };
}
