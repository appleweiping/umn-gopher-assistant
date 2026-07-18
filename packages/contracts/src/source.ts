import { z } from "zod";

import {
  BilingualTextSchema,
  CachePolicySchema,
  CampusIdSchema,
  FreshnessStateSchema,
  IsoDateTimeSchema,
  LicenseStatusSchema,
  OfficialStatusSchema,
  VerificationStateSchema,
} from "./common.js";

export const SourceDescriptorSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,127}$/u),
    campusIds: z.array(CampusIdSchema).min(1),
    name: BilingualTextSchema,
    publisher: z.string().trim().min(1),
    sourceUrl: z.url().refine((url) => url.startsWith("https://"), "Expected an HTTPS URL"),
    licenseStatus: LicenseStatusSchema,
    freshnessState: FreshnessStateSchema,
    verificationState: VerificationStateSchema,
    officialStatus: OfficialStatusSchema,
    attribution: z.string().trim().min(1),
    cachePolicy: CachePolicySchema,
    lastCheckedAt: IsoDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((source, context) => {
    if (source.licenseStatus === "PROHIBITED" && source.cachePolicy !== "NO_ACCESS") {
      context.addIssue({
        code: "custom",
        message: "Prohibited sources must use NO_ACCESS",
        path: ["cachePolicy"],
      });
    }
  });
export type SourceDescriptor = z.infer<typeof SourceDescriptorSchema>;
