import type { z } from "zod";

export function expectSchemaSuccess<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

export function expectSchemaFailure(schema: z.ZodType, value: unknown): readonly z.core.$ZodIssue[] {
  const result = schema.safeParse(value);
  if (result.success) {
    throw new Error("Expected schema parsing to fail");
  }
  return result.error.issues;
}
