import { z } from "zod";

import { IsoDateTimeSchema } from "./common.js";

const ModerationTargetSchema = z
  .object({
    type: z.enum(["community_post", "community_comment", "live_session", "user_profile"]),
    id: z.string().min(1).max(256),
  })
  .strict();

const ModerationResolutionSchema = z
  .object({
    action: z.enum(["NO_ACTION", "CONTENT_REMOVED", "USER_WARNED", "USER_SUSPENDED", "ESCALATED"]),
    rationale: z.string().min(1).max(2000),
    resolvedBy: z.string().min(1).max(256),
    resolvedAt: IsoDateTimeSchema,
  })
  .strict();

export const ModerationCaseSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(["COMMUNITY_REPORT", "LIVE_SAFETY_REPORT", "AUTOMATED_SIGNAL"]),
    state: z.enum(["OPEN", "IN_REVIEW", "RESOLVED", "DISMISSED"]),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
    target: ModerationTargetSchema,
    reasonCodes: z.array(z.string().min(1).max(64)).min(1),
    reporterActorId: z.string().min(1).max(256).nullable(),
    assignedModeratorId: z.string().min(1).max(256).nullable(),
    resolution: ModerationResolutionSchema.nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((moderationCase, context) => {
    const isClosed = moderationCase.state === "RESOLVED" || moderationCase.state === "DISMISSED";
    if (isClosed && moderationCase.resolution === null) {
      context.addIssue({
        code: "custom",
        message: "Closed moderation cases require resolution details",
        path: ["resolution"],
      });
    }
  });
export type ModerationCase = z.infer<typeof ModerationCaseSchema>;
