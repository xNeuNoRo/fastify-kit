import type { FastifyKitMetadata } from "../types.js";

/**
 * @description Decorador de clase o método para documentar un esquema de seguridad
 * personalizado (API Key, OAuth2, OpenID Connect, etc.) en OpenAPI / Scalar.
 *
 * @param name Nombre del security scheme (debe coincidir con lo definido en `swagger.securitySchemes`).
 * @param scopes Scopes requeridos para el endpoint (para OAuth2).
 * @returns Un decorador que puede aplicarse a clase o método.
 *
 * @example
 * ```typescript
 * // En FastifyKit.create():
 * swagger: {
 *   title: "API",
 *   version: "1.0",
 *   securitySchemes: {
 *     apiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
 *     oauth2: {
 *       type: "oauth2",
 *       flows: { clientCredentials: { tokenUrl: "/oauth/token", scopes: { "read:users": "...", "write:users": "..." } } }
 *     }
 *   }
 * }
 *
 * // En el controlador:
 * \@Controller("/users")
 * class UsersController {
 *   \@Get("/")
 *   \@ApiSecurity("apiKeyAuth") // Requiere X-API-Key header
 *   getAll() { ... }
 *
 *   \@Post("/")
 *   \@ApiSecurity("oauth2", ["write:users"]) // Requiere OAuth2 con scope write:users
 *   create() { ... }
 * }
 * ```
 */
export function ApiSecurity(name: string, scopes: string[] = []) {
  return function <T extends Function>(
    _target: T,
    context: ClassDecoratorContext | ClassMethodDecoratorContext,
  ) {
    if (context.kind !== "class" && context.kind !== "method") {
      throw new Error(
        "[FastifyKit] @ApiSecurity solo puede aplicarse a clases o métodos",
      );
    }

    const metadata = context.metadata as FastifyKitMetadata;

    if (context.kind === "class") {
      metadata.openApiClassSecurity ??= [];
      if (!metadata.openApiClassSecurity.find((s) => s.name === name)) {
        metadata.openApiClassSecurity.push({ name, scopes });
      }
    } else {
      metadata.openApiMethodSecurity ??= {};
      metadata.openApiMethodSecurity[context.name] ??= [];
      if (
        !metadata.openApiMethodSecurity[context.name].find(
          (s) => s.name === name,
        )
      ) {
        metadata.openApiMethodSecurity[context.name].push({ name, scopes });
      }
    }
  };
}
