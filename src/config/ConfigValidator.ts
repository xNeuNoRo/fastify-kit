import { TSchema } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import { Value } from "@sinclair/typebox/value";

/**
 * @description Error lanzado cuando la validación de configuración falla.
 * Incluye los paths y mensajes de cada error para debugging preciso.
 */
export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: { path: string; message: string; value?: unknown }[],
  ) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

/**
 * @description Validador de configuración usando TypeBox.
 * Proporciona métodos para compilar esquemas, validar datos y coercionar tipos.
 * Utiliza TypeCompiler para compilación JIT de esquemas (más rápido que Value.Check).
 */
export class ConfigValidator {
  /**
   * @description Compila un esquema TypeBox para validación rápida.
   * Usa TypeCompiler que genera código JIT optimizado en lugar de interpretar el esquema cada vez.
   * @param schema El esquema TypeBox a compilar.
   * @returns Un TypeCompiler validado y listo para usar.
   */
  static compile(schema: TSchema) {
    return TypeCompiler.Compile(schema);
  }

  /**
   * @description Valida datos contra un esquema TypeBox compilado.
   * Si la validación falla, extrae los errores con paths precisos y lanza ConfigValidationError.
   * @param compiled El compilador retornado por ConfigValidator.compile().
   * @param data Los datos a validar.
   * @returns Los datos validados (con defaults aplicados).
   * @throws ConfigValidationError si la validación falla.
   */
  static validate(
    compiled: ReturnType<typeof TypeCompiler.Compile>,
    data: unknown,
  ): unknown {
    if (!compiled.Check(data)) {
      const errors = [...compiled.Errors(data)].map((e) => ({
        path: e.path,
        message: e.message,
        value: e.value,
      }));

      throw new ConfigValidationError(
        `[FastifyKit Config] Falló la validación de configuración. Revisa los errores a continuación:`,
        errors,
      );
    }

    return data;
  }

  /**
   * @description Coerciona y aplica valores por defecto a datos según un esquema TypeBox.
   * Primero convierte tipos (ej: "123" → 123, "true" → true) usando Value.Convert.
   * Luego aplica los valores por defecto definidos en el esquema usando Value.Default.
   *
   * IMPORTANTE: No usa Value.Cast() para evitar que TypeBox invente datos
   * en campos requeridos faltantes. Queremos que la validación falle si faltan datos.
   *
   * @param schema El esquema TypeBox que define tipos y defaults.
   * @param data Los datos a coercionar.
   * @returns Datos coercionados y con defaults aplicados.
   */
  static coerce<T extends TSchema>(schema: T, data: unknown): unknown {
    const converted = Value.Convert(schema, data);
    return Value.Default(schema, converted);
  }

  /**
   * @description Valida que no haya claves desconocidas (typos, vars no documentadas).
   * Útil cuando strict: true en ConfigModule para evitar bugs silenciosos.
   * @param schema El esquema TypeBox que define las claves esperadas.
   * @param data Los datos a verificar.
   * @returns Array de nombres de claves no declaradas en el schema.
   */
  static findUnknownKeys(schema: TSchema, data: Record<string, unknown>): string[] {
    const schemaKeys = Object.keys((schema as any).properties || {});
    return Object.keys(data).filter((key) => !schemaKeys.includes(key));
  }
}
