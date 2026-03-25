import { Type, TSchema } from "@sinclair/typebox";

export const createApiResponseSchema = <T extends TSchema>(
  dataSchema: T,
  description?: string,
) => {
  return Type.Object(
    {
      ok: Type.Boolean(),
      data: Type.Union([dataSchema, Type.Null()]),
      error: Type.Union([
        Type.Null(),
        Type.Object({
          code: Type.String(),
          message: Type.String(),
          details: Type.Optional(Type.Any()),
        }),
      ]),
      timestamp: Type.String({ format: "date-time" }),
    },
    { description },
  );
};
