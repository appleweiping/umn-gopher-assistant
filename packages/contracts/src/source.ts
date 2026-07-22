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

export const SourceIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,127}$/u);
export type SourceId = z.infer<typeof SourceIdSchema>;

const MAX_TERMS_REVIEW_INTERVAL_MS = 366 * 24 * 60 * 60 * 1_000;

export const SourceResourceKindSchema = z.enum(["CAMPUS_DEEPLINK", "ACADEMIC_SESSION", "PUBLIC_EVENT"]);
export type SourceResourceKind = z.infer<typeof SourceResourceKindSchema>;

export const SourceDataClassificationSchema = z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]);
export type SourceDataClassification = z.infer<typeof SourceDataClassificationSchema>;

export const SourceDataClassSchema = z.enum([
  "PUBLIC_METADATA",
  "COPYRIGHTED_CONTENT",
  "PRECISE_LOCATION",
  "PERSONAL_DATA",
  "SENSITIVE_DATA",
  "SAFETY_CRITICAL",
  "MEDIA",
]);
export type SourceDataClass = z.infer<typeof SourceDataClassSchema>;

export const SourceOwnerSchema = z
  .object({
    teamId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/u),
    contactUrl: z.url().refine((url) => url.startsWith("https://"), "Expected an HTTPS URL"),
  })
  .strict();
export type SourceOwner = z.infer<typeof SourceOwnerSchema>;

export const SourceKillSwitchSchema = z
  .object({
    key: z.string().regex(/^source\.[a-z0-9][a-z0-9.-]{2,127}\.enabled$/u),
    defaultState: z.enum(["ENABLED", "DISABLED"]),
    fallback: z.enum(["DEEPLINK_ONLY", "UNAVAILABLE"]),
  })
  .strict();
export type SourceKillSwitch = z.infer<typeof SourceKillSwitchSchema>;

const ContentRetentionDispositionSchema = z.enum(["NEVER_STORE", "TRANSIENT_ONLY", "PERSIST_WITH_TTL"]);

export const CacheDispositionSchema = z
  .object({
    rawResponse: ContentRetentionDispositionSchema,
    normalizedRecords: ContentRetentionDispositionSchema,
    derivedArtifacts: z.enum(["PROHIBITED", "SAME_RETENTION", "SEPARATE_APPROVAL"]),
    retentionSeconds: z.number().int().positive().max(31_536_000).nullable(),
  })
  .strict()
  .superRefine((disposition, context) => {
    const persists =
      disposition.rawResponse === "PERSIST_WITH_TTL" || disposition.normalizedRecords === "PERSIST_WITH_TTL";
    if (persists !== (disposition.retentionSeconds !== null)) {
      context.addIssue({
        code: "custom",
        message: "retentionSeconds is required exactly when source content is persisted",
        path: ["retentionSeconds"],
      });
    }
  });
export type CacheDisposition = z.infer<typeof CacheDispositionSchema>;

export const SourceDescriptorSchema = z
  .object({
    id: SourceIdSchema,
    campusIds: z.array(CampusIdSchema).min(1).max(5),
    resourceKinds: z.array(SourceResourceKindSchema).min(1).max(SourceResourceKindSchema.options.length),
    name: BilingualTextSchema,
    publisher: z.string().trim().min(1).max(256),
    sourceUrl: z.url().refine((url) => url.startsWith("https://"), "Expected an HTTPS URL"),
    licenseStatus: LicenseStatusSchema,
    licenseEvidenceUrl: z
      .url()
      .refine((url) => url.startsWith("https://"), "Expected an HTTPS URL")
      .nullable(),
    authorizationEvidenceUrl: z
      .url()
      .refine((url) => url.startsWith("https://"), "Expected an HTTPS URL")
      .nullable(),
    freshnessState: FreshnessStateSchema,
    verificationState: VerificationStateSchema,
    officialStatus: OfficialStatusSchema,
    attribution: z.string().trim().min(1).max(2_048),
    cachePolicy: CachePolicySchema,
    cacheDisposition: CacheDispositionSchema,
    dataClassification: SourceDataClassificationSchema,
    dataClasses: z.array(SourceDataClassSchema).min(1).max(SourceDataClassSchema.options.length),
    owner: SourceOwnerSchema,
    killSwitch: SourceKillSwitchSchema,
    termsReviewedAt: IsoDateTimeSchema.nullable(),
    termsReviewExpiresAt: IsoDateTimeSchema.nullable(),
    lastCheckedAt: IsoDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((source, context) => {
    if (new Set(source.campusIds).size !== source.campusIds.length) {
      context.addIssue({ code: "custom", message: "campusIds must be unique", path: ["campusIds"] });
    }
    if (new Set(source.resourceKinds).size !== source.resourceKinds.length) {
      context.addIssue({
        code: "custom",
        message: "resourceKinds must be unique",
        path: ["resourceKinds"],
      });
    }
    if (new Set(source.dataClasses).size !== source.dataClasses.length) {
      context.addIssue({ code: "custom", message: "dataClasses must be unique", path: ["dataClasses"] });
    }
    if (source.killSwitch.key !== `source.${source.id}.enabled`) {
      context.addIssue({
        code: "custom",
        message: "kill-switch key must be derived from the source ID",
        path: ["killSwitch", "key"],
      });
    }

    if (source.freshnessState === "FRESH" && source.lastCheckedAt === null) {
      context.addIssue({
        code: "custom",
        message: "Fresh sources require lastCheckedAt evidence",
        path: ["lastCheckedAt"],
      });
    }

    if (source.licenseStatus === "OPEN_REUSE" && source.licenseEvidenceUrl === null) {
      context.addIssue({
        code: "custom",
        message: "Open reuse requires a reviewed license evidence URL",
        path: ["licenseEvidenceUrl"],
      });
    }

    if (source.officialStatus === "PARTNERSHIP_VERIFIED" && source.authorizationEvidenceUrl === null) {
      context.addIssue({
        code: "custom",
        message: "A verified partnership requires authorization evidence",
        path: ["authorizationEvidenceUrl"],
      });
    }

    if (source.licenseStatus === "LIVE_ONLY") {
      if (source.authorizationEvidenceUrl === null) {
        context.addIssue({
          code: "custom",
          message: "LIVE_ONLY sources require authorization evidence for the reviewed live-access purpose",
          path: ["authorizationEvidenceUrl"],
        });
      }
      if (source.termsReviewedAt === null) {
        context.addIssue({
          code: "custom",
          message: "LIVE_ONLY sources require a terms review timestamp",
          path: ["termsReviewedAt"],
        });
      }
      if (source.termsReviewExpiresAt === null) {
        context.addIssue({
          code: "custom",
          message: "LIVE_ONLY sources require a terms review expiry",
          path: ["termsReviewExpiresAt"],
        });
      }
    }

    if ((source.termsReviewedAt === null) !== (source.termsReviewExpiresAt === null)) {
      context.addIssue({
        code: "custom",
        message: "Terms review and expiry timestamps must be recorded together",
        path: [source.termsReviewedAt === null ? "termsReviewedAt" : "termsReviewExpiresAt"],
      });
    }

    if (source.termsReviewedAt !== null && source.termsReviewExpiresAt !== null) {
      const reviewedAt = Date.parse(source.termsReviewedAt);
      const expiresAt = Date.parse(source.termsReviewExpiresAt);
      const reviewInterval = expiresAt - reviewedAt;
      if (reviewInterval <= 0) {
        context.addIssue({
          code: "custom",
          message: "Terms review expiry must be later than the review timestamp",
          path: ["termsReviewExpiresAt"],
        });
      } else if (reviewInterval > MAX_TERMS_REVIEW_INTERVAL_MS) {
        context.addIssue({
          code: "custom",
          message: "Terms review interval cannot exceed 366 days",
          path: ["termsReviewExpiresAt"],
        });
      }
    }

    if (
      (source.licenseStatus === "APPROVAL_REQUIRED" || source.licenseStatus === "PROHIBITED") &&
      (source.termsReviewedAt !== null || source.termsReviewExpiresAt !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Unapproved or prohibited sources cannot carry live-access review timestamps",
        path: ["termsReviewedAt"],
      });
    }

    if (
      (source.licenseStatus === "APPROVAL_REQUIRED" || source.licenseStatus === "PROHIBITED") &&
      source.cachePolicy !== "NO_ACCESS"
    ) {
      context.addIssue({
        code: "custom",
        message: "Unapproved or prohibited sources must use NO_ACCESS",
        path: ["cachePolicy"],
      });
    }

    if (
      (source.licenseStatus === "APPROVAL_REQUIRED" || source.licenseStatus === "PROHIBITED") &&
      source.killSwitch.defaultState !== "DISABLED"
    ) {
      context.addIssue({
        code: "custom",
        message: "Unapproved or prohibited sources must be disabled by default",
        path: ["killSwitch", "defaultState"],
      });
    }

    const { cacheDisposition } = source;
    if (source.cachePolicy === "NO_ACCESS") {
      if (
        cacheDisposition.rawResponse !== "NEVER_STORE" ||
        cacheDisposition.normalizedRecords !== "NEVER_STORE" ||
        cacheDisposition.derivedArtifacts !== "PROHIBITED" ||
        cacheDisposition.retentionSeconds !== null
      ) {
        context.addIssue({
          code: "custom",
          message: "NO_ACCESS must prohibit all source-content retention",
          path: ["cacheDisposition"],
        });
      }
    }

    if (source.cachePolicy === "NO_CONTENT_CACHE") {
      if (
        cacheDisposition.rawResponse === "PERSIST_WITH_TTL" ||
        cacheDisposition.normalizedRecords === "PERSIST_WITH_TTL" ||
        cacheDisposition.derivedArtifacts !== "PROHIBITED"
      ) {
        context.addIssue({
          code: "custom",
          message: "NO_CONTENT_CACHE permits only transient source content and no derived artifacts",
          path: ["cacheDisposition"],
        });
      }
    }

    if (source.licenseStatus === "LIVE_ONLY" && source.cachePolicy === "CACHE_ALLOWED") {
      context.addIssue({
        code: "custom",
        message: "LIVE_ONLY sources cannot allow durable content caching",
        path: ["cachePolicy"],
      });
    }
  });
export type SourceDescriptor = z.infer<typeof SourceDescriptorSchema>;

export const SourceRegistrySchema = z
  .array(SourceDescriptorSchema)
  .min(1)
  .max(10_000)
  .superRefine((sources, context) => {
    const sourceIds = new Set<string>();
    const killSwitchKeys = new Set<string>();
    for (const [index, source] of sources.entries()) {
      if (sourceIds.has(source.id)) {
        context.addIssue({
          code: "custom",
          message: "Source IDs must be unique",
          path: [index, "id"],
        });
      }
      if (killSwitchKeys.has(source.killSwitch.key)) {
        context.addIssue({
          code: "custom",
          message: "Source kill-switch keys must be unique",
          path: [index, "killSwitch", "key"],
        });
      }
      sourceIds.add(source.id);
      killSwitchKeys.add(source.killSwitch.key);
    }
  });
export type SourceRegistry = z.infer<typeof SourceRegistrySchema>;
