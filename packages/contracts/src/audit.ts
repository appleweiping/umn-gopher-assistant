import { z } from "zod";

import { IsoDateTimeSchema } from "./common.js";

const AuditSubjectSchema = z
  .object({
    type: z.string().min(1).max(64),
    id: z.string().min(1).max(256),
  })
  .strict();

export const AuditEventSchema = z
  .object({
    id: z.uuid(),
    occurredAt: IsoDateTimeSchema,
    actor: AuditSubjectSchema,
    action: z.string().regex(/^[a-z][a-z0-9_.-]{2,127}$/u),
    target: AuditSubjectSchema,
    outcome: z.enum(["SUCCESS", "DENIED", "FAILURE"]),
    traceId: z.string().regex(/^[a-f0-9]{16,64}$/u),
    metadata: z.record(z.string(), z.unknown()),
  })
  .strict();
export type AuditEvent = z.infer<typeof AuditEventSchema>;
