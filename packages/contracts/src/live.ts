import { z } from "zod";

import { Base64UrlSchema, BilingualTextSchema, CampusIdSchema, IsoDateTimeSchema } from "./common.js";

export const WorldJoinTicketSchema = z
  .object({
    ticketId: z.uuid(),
    campusId: CampusIdSchema,
    participantId: z.string().min(1).max(128),
    roomName: z.string().min(1).max(128),
    token: z.string().min(16).max(4096),
    deviceBoundNonce: z.string().min(8).max(256),
    scopes: z.array(z.enum(["world:join", "presence:publish", "media:publish"])).min(1),
    issuedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
  })
  .strict()
  .refine((ticket) => Date.parse(ticket.expiresAt) > Date.parse(ticket.issuedAt), {
    message: "expiresAt must follow issuedAt",
    path: ["expiresAt"],
  });
export type WorldJoinTicket = z.infer<typeof WorldJoinTicketSchema>;

export const LiveEventPolicySchema = z
  .object({
    eventId: z.string().min(1).max(128),
    policyVersion: z.string().min(1).max(64),
    recordingAllowed: z.boolean(),
    transcriptionAllowed: z.boolean(),
    consentRequired: z.boolean(),
    retentionDays: z.number().int().min(0).max(3650),
    consentNotice: BilingualTextSchema,
    effectiveAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((policy, context) => {
    if ((policy.recordingAllowed || policy.transcriptionAllowed) && !policy.consentRequired) {
      context.addIssue({
        code: "custom",
        message: "Recording or transcription requires explicit consent",
        path: ["consentRequired"],
      });
    }
  });
export type LiveEventPolicy = z.infer<typeof LiveEventPolicySchema>;

export const LiveEventTokenDigestSchema = Base64UrlSchema;
