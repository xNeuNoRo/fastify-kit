import type { FastifyKitMetadata } from "../types.js";

/**
 * @description Decorador de clase o método para indicar que un endpoint requiere autenticación
 * JWT Bearer Token. Agrega el esquema de seguridad `bearerAuth` en OpenAPI y habilita el botón
 * "Authorize" en Scalar para probar los endpoints protegidos con un token JWT.
 *
 * @param name Nombre del security scheme (por defecto: "bearerAuth").
 * @returns Un decorador que puede aplicarse a clase o método.
 *
 * @example
 * ```typescript
 * \@ApiTags("Admin")
 * \@ApiBearerAuth()
 * \@Controller("/admin")
 * class AdminController {
 *   \@Get("/dashboard")
 *   dashboard() { ... } // Requiere JWT
 *
 *   \@Get("/public")
 *   \@ApiBearerAuth() // Si se aplica a clase, este método también lo hereda
 *   getPublic() { ... } // No hereda si se usa a nivel de clase y no a nivel de método
 * }
 * ```
 *
 * @remarks Si FastifyKit detecta `jwt: true` en las opciones, registra automáticamente
 * el security scheme `bearerAuth` en OpenAPI. Este decorador simplemente lo enlaza al endpoint.
 * Si el decorador se aplica a nivel de clase, todos los métodos heredan el requisito.
 * Para excluir un método específico, usar `@ApiBearerAuth()` sin argumentos no es suficiente;
 * en su lugar, se debe aplicar un override explícito (próximamente soportado).
 */
export function ApiBearerAuth(name: string = "bearerAuth") {
  return function <T extends Function>(
    _target: T,
    context: ClassDecoratorContext | ClassMethodDecoratorContext,
  ) {
    if (context.kind !== "class" && context.kind !== "method") {
      throw new Error(
        "[FastifyKit] @ApiBearerAuth solo puede aplicarse a clases o métodos",
      );
    }

    const metadata = context.metadata as FastifyKitMetadata;

    if (context.kind === "class") {
      metadata.openApiClassSecurity ??= [];
      // Evitar duplicados
      if (
        !metadata.openApiClassSecurity.find((s) => s.name === name)
      ) {
        metadata.openApiClassSecurity.push({ name });
      }
    } else {
      metadata.openApiMethodSecurity ??= {};
      metadata.openApiMethodSecurity[context.name] ??= [];
      if (
        !metadata.openApiMethodSecurity[context.name].find(
          (s) => s.name === name,
        )
      ) {
        metadata.openApiMethodSecurity[context.name].push({ name });
      }
    }
  };
}
