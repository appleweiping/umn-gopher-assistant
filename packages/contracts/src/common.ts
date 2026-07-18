import { z } from "zod";

export const CampusIdSchema = z.enum(["tc", "duluth", "crookston", "morris", "rochester"]);
export type CampusId = z.infer<typeof CampusIdSchema>;

export const BilingualTextSchema = z
  .object({
    en: z.string().trim().min(1),
    "zh-CN": z.string().trim().min(1),
  })
  .strict();
export type BilingualText = z.infer<typeof BilingualTextSchema>;

export const LicenseStatusSchema = z.enum([
  "OPEN_REUSE",
  "LIVE_ONLY",
  "DEEPLINK_ONLY",
  "APPROVAL_REQUIRED",
  "PROHIBITED",
]);
export type LicenseStatus = z.infer<typeof LicenseStatusSchema>;

export const FreshnessStateSchema = z.enum(["FRESH", "STALE", "EXPIRED", "UNKNOWN"]);
export type FreshnessState = z.infer<typeof FreshnessStateSchema>;

export const VerificationStateSchema = z.enum(["SCHEMATIC", "UNVERIFIED", "VERIFIED", "REJECTED"]);
export type VerificationState = z.infer<typeof VerificationStateSchema>;

export const OfficialStatusSchema = z.enum(["UNVERIFIED", "PUBLISHER_ASSERTED", "PARTNERSHIP_VERIFIED"]);
export type OfficialStatus = z.infer<typeof OfficialStatusSchema>;

export const CachePolicySchema = z.enum(["CACHE_ALLOWED", "METADATA_ONLY", "NO_CONTENT_CACHE", "NO_ACCESS"]);
export type CachePolicy = z.infer<typeof CachePolicySchema>;

export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u, "Expected a lowercase SHA-256 digest");
export const Base64UrlSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/u, "Expected unpadded base64url");

export const GeographicPointSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
export type GeographicPoint = z.infer<typeof GeographicPointSchema>;

export const GeographicPositionSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
  z.number(),
]);
export type GeographicPosition = z.infer<typeof GeographicPositionSchema>;
