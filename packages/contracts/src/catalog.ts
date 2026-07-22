import { z } from "zod";

import { CAMPUS_ACADEMIC_INSTITUTION_MAP, AcademicInstitutionCodeSchema } from "./campus.js";
import {
  CachePolicySchema,
  CampusIdSchema,
  FreshnessStateSchema,
  GeographicPointSchema,
  IsoDateTimeSchema,
  LicenseStatusSchema,
  Sha256Schema,
} from "./common.js";
import { SourceDataClassificationSchema, SourceIdSchema } from "./source.js";

const SourceTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(20_000)
  .refine(
    (value) =>
      !Array.from(value).some((character) => {
        const codePoint = character.codePointAt(0);
        return (
          codePoint !== undefined &&
          ((codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13) || codePoint === 127)
        );
      }),
    "Source text contains unsupported control characters",
  );

const CatalogRecordIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u);
const IsoDateSchema = z.iso.date();
const HttpsUrlSchema = z.url().refine((url) => url.startsWith("https://"), "Expected an HTTPS URL");

export const AcademicSessionSchema = z
  .object({
    id: CatalogRecordIdSchema,
    campusId: CampusIdSchema,
    institutionCode: AcademicInstitutionCodeSchema,
    academicCareerCode: z.string().regex(/^[A-Z0-9]{2,12}$/u),
    termCode: z.string().regex(/^\d{4}$/u),
    sessionCode: z.string().regex(/^[A-Z0-9]{1,12}$/u),
    name: SourceTextSchema.max(256),
    beginDate: IsoDateSchema,
    endDate: IsoDateSchema,
    enrollmentOpenDate: IsoDateSchema.nullable(),
    sourceId: SourceIdSchema,
    sourceObservationId: z.uuid(),
    observedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((session, context) => {
    if (session.institutionCode !== CAMPUS_ACADEMIC_INSTITUTION_MAP[session.campusId]) {
      context.addIssue({
        code: "custom",
        message: "institutionCode must match the configured campus academic institution",
        path: ["institutionCode"],
      });
    }
    if (session.endDate < session.beginDate) {
      context.addIssue({
        code: "custom",
        message: "endDate must not precede beginDate",
        path: ["endDate"],
      });
    }
    if (session.enrollmentOpenDate !== null && session.enrollmentOpenDate > session.endDate) {
      context.addIssue({
        code: "custom",
        message: "enrollmentOpenDate must not follow endDate",
        path: ["enrollmentOpenDate"],
      });
    }
  });
export type AcademicSession = z.infer<typeof AcademicSessionSchema>;

export const PublicEventStatusSchema = z.enum(["SCHEDULED", "POSTPONED", "CANCELLED"]);
export type PublicEventStatus = z.infer<typeof PublicEventStatusSchema>;

export const PublicEventLocationSchema = z
  .object({
    name: SourceTextSchema.max(512).nullable(),
    address: SourceTextSchema.max(1_024).nullable(),
    coordinates: GeographicPointSchema.nullable(),
    onlineUrl: HttpsUrlSchema.nullable(),
  })
  .strict()
  .refine((location) => Object.values(location).some((value) => value !== null), {
    message: "An event location must contain at least one value",
  });
export type PublicEventLocation = z.infer<typeof PublicEventLocationSchema>;

export const PublicEventSchema = z
  .object({
    id: CatalogRecordIdSchema,
    campusId: CampusIdSchema,
    title: SourceTextSchema.max(1_024),
    descriptionText: SourceTextSchema.nullable(),
    language: z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u),
    startsAt: IsoDateTimeSchema,
    endsAt: IsoDateTimeSchema.nullable(),
    allDay: z.boolean(),
    timeZone: z
      .string()
      .min(1)
      .max(128)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value }).format();
          return true;
        } catch {
          return false;
        }
      }, "Expected an IANA time-zone identifier"),
    status: PublicEventStatusSchema,
    location: PublicEventLocationSchema.nullable(),
    canonicalUrl: HttpsUrlSchema,
    categories: z.array(SourceTextSchema.max(128)).max(32),
    sourceId: SourceIdSchema,
    sourceObservationId: z.uuid(),
    observedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((event, context) => {
    if (event.endsAt !== null && Date.parse(event.endsAt) <= Date.parse(event.startsAt)) {
      context.addIssue({
        code: "custom",
        message: "endsAt must follow startsAt",
        path: ["endsAt"],
      });
    }
    if (new Set(event.categories).size !== event.categories.length) {
      context.addIssue({ code: "custom", message: "categories must be unique", path: ["categories"] });
    }
  });
export type PublicEvent = z.infer<typeof PublicEventSchema>;

export const SourceObservationOutcomeSchema = z.enum([
  "SUCCESS",
  "NOT_MODIFIED",
  "DISABLED",
  "TIMEOUT",
  "RATE_LIMITED",
  "ACCESS_DENIED",
  "SCHEMA_MISMATCH",
  "UPSTREAM_ERROR",
]);
export type SourceObservationOutcome = z.infer<typeof SourceObservationOutcomeSchema>;

export const AppliedCacheDispositionSchema = z.enum([
  "NO_ACCESS",
  "DISCARDED_AFTER_RESPONSE",
  "OPERATIONAL_METADATA_ONLY",
  "CONTENT_CACHED",
]);
export type AppliedCacheDisposition = z.infer<typeof AppliedCacheDispositionSchema>;

export const SourceObservationSchema = z
  .object({
    observationId: z.uuid(),
    sourceId: SourceIdSchema,
    campusId: CampusIdSchema,
    observedAt: IsoDateTimeSchema,
    durationMs: z.number().int().nonnegative().max(120_000),
    outcome: SourceObservationOutcomeSchema,
    httpStatus: z.number().int().min(100).max(599).nullable(),
    parserVersion: z.string().regex(/^[a-z0-9][a-z0-9._@/-]{0,127}$/u),
    rawSha256: Sha256Schema.nullable(),
    rawByteLength: z.number().int().nonnegative().max(10_485_760).nullable(),
    recordsAccepted: z.number().int().nonnegative().max(1_000_000),
    recordsRejected: z.number().int().nonnegative().max(1_000_000),
    freshnessState: FreshnessStateSchema,
    licenseStatus: LicenseStatusSchema,
    cachePolicy: CachePolicySchema,
    appliedCacheDisposition: AppliedCacheDispositionSchema,
    dataClassification: SourceDataClassificationSchema,
    failureCode: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{2,63}$/u)
      .nullable(),
  })
  .strict()
  .superRefine((observation, context) => {
    if (observation.outcome === "SUCCESS") {
      if (observation.httpStatus === null || observation.httpStatus < 200 || observation.httpStatus >= 300) {
        context.addIssue({
          code: "custom",
          message: "A successful observation requires a 2xx HTTP status",
          path: ["httpStatus"],
        });
      }
      if (observation.rawSha256 === null || observation.rawByteLength === null) {
        context.addIssue({
          code: "custom",
          message: "A successful observation requires raw response integrity metadata",
          path: ["rawSha256"],
        });
      }
      if (observation.failureCode !== null) {
        context.addIssue({
          code: "custom",
          message: "A successful observation cannot have a failureCode",
          path: ["failureCode"],
        });
      }
    } else if (observation.outcome === "NOT_MODIFIED") {
      if (observation.httpStatus !== 304) {
        context.addIssue({
          code: "custom",
          message: "A not-modified observation requires HTTP 304",
          path: ["httpStatus"],
        });
      }
      if (observation.rawSha256 !== null || observation.rawByteLength !== null) {
        context.addIssue({
          code: "custom",
          message: "A not-modified observation cannot claim a response body",
          path: ["rawSha256"],
        });
      }
      if (observation.failureCode !== null) {
        context.addIssue({
          code: "custom",
          message: "A not-modified observation cannot have a failureCode",
          path: ["failureCode"],
        });
      }
    } else if (observation.failureCode === null) {
      context.addIssue({
        code: "custom",
        message: "A non-success observation requires a stable failureCode",
        path: ["failureCode"],
      });
    }

    if (observation.outcome === "DISABLED") {
      if (
        observation.httpStatus !== null ||
        observation.rawSha256 !== null ||
        observation.rawByteLength !== null ||
        observation.recordsAccepted !== 0 ||
        observation.recordsRejected !== 0
      ) {
        context.addIssue({
          code: "custom",
          message: "A disabled source must not have network or record-processing evidence",
          path: ["outcome"],
        });
      }
    }

    if (observation.cachePolicy === "NO_ACCESS") {
      if (observation.outcome !== "DISABLED" || observation.appliedCacheDisposition !== "NO_ACCESS") {
        context.addIssue({
          code: "custom",
          message: "NO_ACCESS observations must prove that the source remained disabled",
          path: ["appliedCacheDisposition"],
        });
      }
    }

    if (
      observation.cachePolicy === "NO_CONTENT_CACHE" &&
      observation.appliedCacheDisposition === "CONTENT_CACHED"
    ) {
      context.addIssue({
        code: "custom",
        message: "NO_CONTENT_CACHE observations cannot retain source content",
        path: ["appliedCacheDisposition"],
      });
    }

    if (
      (observation.licenseStatus === "APPROVAL_REQUIRED" || observation.licenseStatus === "PROHIBITED") &&
      (observation.cachePolicy !== "NO_ACCESS" || observation.outcome !== "DISABLED")
    ) {
      context.addIssue({
        code: "custom",
        message: "Unapproved or prohibited sources must remain disabled with NO_ACCESS",
        path: ["licenseStatus"],
      });
    }
  });
export type SourceObservation = z.infer<typeof SourceObservationSchema>;
