import { z } from "zod";

import {
  BilingualTextSchema,
  GeographicPointSchema,
  IsoDateTimeSchema,
  VerificationStateSchema,
} from "./common.js";

export const RouteProfileSchema = z.enum(["walking", "wheelchair"]);
export type RouteProfile = z.infer<typeof RouteProfileSchema>;

export const RouteSegmentSchema = z
  .object({
    id: z.string().min(1).max(128),
    profile: RouteProfileSchema,
    geometry: z.array(GeographicPointSchema).min(2),
    distanceMeters: z.number().nonnegative(),
    durationSeconds: z.number().nonnegative(),
    instructions: BilingualTextSchema,
    verificationState: VerificationStateSchema,
    safetyCritical: z.boolean(),
    sourceIds: z.array(z.string().min(1)).min(1),
    validUntil: IsoDateTimeSchema.nullable(),
  })
  .strict();
export type RouteSegment = z.infer<typeof RouteSegmentSchema>;
