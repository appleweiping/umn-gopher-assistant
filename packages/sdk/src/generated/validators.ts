/**
 * Generated from openapi/openapi.yaml. DO NOT EDIT.
 * Run `pnpm --filter @umn-gopher-assistant/sdk generate` after contract changes.
 */

import { z } from "zod";

import { operationDefinitions } from "./operations.js";
import type { OperationId } from "./operations.js";

export const successValidatorContractSha256 =
  "1cbefacdd1bbdc254fb300ed7d05d39f539c8ffc877e5bbc352a63a3ac2268e1";

type ImplementedOperationId = {
  [Id in OperationId]: (typeof operationDefinitions)[Id]["runtimeStatus"] extends "implemented" ? Id : never;
}[OperationId];

const implementedSuccessSchemas = {
  getHealth: {
    "200": z
      .object({
        service: z.literal("campus-api"),
        status: z.literal("ok"),
        time: z.iso.datetime({ offset: true }),
        version: z.string(),
      })
      .strict(),
  },
  getWorldManifest: {
    "200": z
      .object({
        campusId: z.enum(["tc", "duluth", "crookston", "morris", "rochester"]),
        etag: z.string(),
        generatedAt: z.iso.datetime({ offset: true }),
        portals: z.array(
          z
            .object({
              fromCampusId: z.enum(["tc", "duluth", "crookston", "morris", "rochester"]),
              id: z.string(),
              label: z
                .object({
                  en: z.string().min(1),
                  "zh-CN": z.string().min(1),
                })
                .strict(),
              position: z.array(z.number()).min(3).max(3),
              targetWorldVersion: z.string(),
              toCampusId: z.enum(["tc", "duluth", "crookston", "morris", "rochester"]),
              verificationState: z.enum(["schematic", "surveyed", "campus-reviewed", "verified", "retired"]),
            })
            .strict(),
        ),
        revision: z.number().int().min(1),
        sourceIds: z.array(z.string()).min(1),
        tiles: z.array(
          z
            .object({
              bounds: z.array(z.number()).min(4).max(4),
              byteLength: z.number().int().min(1),
              contentType: z.string(),
              id: z.string(),
              licenseStatus: z.enum([
                "OPEN_REUSE",
                "LIVE_ONLY",
                "DEEPLINK_ONLY",
                "APPROVAL_REQUIRED",
                "PROHIBITED",
              ]),
              maxZoom: z.number().int().min(0).max(24),
              minZoom: z.number().int().min(0).max(24),
              sha256: z.string().regex(new RegExp("^[a-f0-9]{64}$")),
              url: z.url(),
              verificationState: z.enum(["schematic", "surveyed", "campus-reviewed", "verified", "retired"]),
            })
            .strict(),
        ),
        verificationState: z.enum(["schematic", "surveyed", "campus-reviewed", "verified", "retired"]),
        worldVersion: z.string(),
      })
      .strict(),
  },
  listAcademicSessions: {
    "200": z
      .object({
        items: z
          .array(
            z
              .object({
                academicCareerCode: z.string().regex(new RegExp("^[A-Z0-9]{2,12}$")),
                beginDate: z.string().regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")),
                campusId: z.enum(["tc", "duluth", "crookston", "morris", "rochester"]),
                endDate: z.string().regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")),
                enrollmentOpenDate: z.union([
                  z.string().regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")),
                  z.null(),
                ]),
                id: z.string().regex(new RegExp("^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")),
                institutionCode: z.enum(["UMNTC", "UMNDL", "UMNCR", "UMNMO"]),
                name: z.string().min(1).max(256),
                observedAt: z.iso.datetime({ offset: true }),
                sessionCode: z.string().regex(new RegExp("^[A-Z0-9]{1,12}$")),
                sourceId: z.string().regex(new RegExp("^[a-z0-9][a-z0-9-]{2,127}$")),
                sourceObservationId: z
                  .string()
                  .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
                termCode: z.string().regex(new RegExp("^[0-9]{4}$")),
              })
              .strict()
              .refine(
                (value) =>
                  !(
                    Object.hasOwn(value, "campusId") &&
                    (!Object.hasOwn(value, "campusId") || ["tc", "rochester"].includes(value["campusId"]))
                  ) ||
                  (Object.hasOwn(value, "institutionCode") &&
                    (!Object.hasOwn(value, "institutionCode") || value["institutionCode"] === "UMNTC")),
                {
                  message:
                    "Conditional constraint from listAcademicSessions.responses.200.application/json.properties.items.items.allOf[0] failed",
                },
              )
              .refine(
                (value) =>
                  !(
                    Object.hasOwn(value, "campusId") &&
                    (!Object.hasOwn(value, "campusId") || value["campusId"] === "duluth")
                  ) ||
                  (Object.hasOwn(value, "institutionCode") &&
                    (!Object.hasOwn(value, "institutionCode") || value["institutionCode"] === "UMNDL")),
                {
                  message:
                    "Conditional constraint from listAcademicSessions.responses.200.application/json.properties.items.items.allOf[1] failed",
                },
              )
              .refine(
                (value) =>
                  !(
                    Object.hasOwn(value, "campusId") &&
                    (!Object.hasOwn(value, "campusId") || value["campusId"] === "crookston")
                  ) ||
                  (Object.hasOwn(value, "institutionCode") &&
                    (!Object.hasOwn(value, "institutionCode") || value["institutionCode"] === "UMNCR")),
                {
                  message:
                    "Conditional constraint from listAcademicSessions.responses.200.application/json.properties.items.items.allOf[2] failed",
                },
              )
              .refine(
                (value) =>
                  !(
                    Object.hasOwn(value, "campusId") &&
                    (!Object.hasOwn(value, "campusId") || value["campusId"] === "morris")
                  ) ||
                  (Object.hasOwn(value, "institutionCode") &&
                    (!Object.hasOwn(value, "institutionCode") || value["institutionCode"] === "UMNMO")),
                {
                  message:
                    "Conditional constraint from listAcademicSessions.responses.200.application/json.properties.items.items.allOf[3] failed",
                },
              ),
          )
          .max(100),
        nextCursor: z.union([
          z.string().min(45).max(1994).regex(new RegExp("^[A-Za-z0-9_-]{1,1950}\\.[A-Za-z0-9_-]{43}$")),
          z.null(),
        ]),
        range: z
          .object({
            defaulted: z.boolean(),
            from: z.string().regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")),
            to: z.string().regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")),
          })
          .strict(),
        retrievalCoverage: z
          .object({
            nextUpstreamPage: z.union([z.number().int().min(1).max(20), z.null()]),
            pagesFetched: z.number().int().min(1).max(3),
            recordsFetched: z.number().int().min(0).max(50000),
            sourceTotalPages: z.number().int().min(0),
            sourceTotalRecords: z.number().int().min(0),
            truncatedByPolicy: z.boolean(),
          })
          .strict(),
        sourceObservations: z
          .array(
            z
              .object({
                appliedCacheDisposition: z.enum([
                  "NO_ACCESS",
                  "DISCARDED_AFTER_RESPONSE",
                  "OPERATIONAL_METADATA_ONLY",
                  "CONTENT_CACHED",
                ]),
                cachePolicy: z.enum(["CACHE_ALLOWED", "METADATA_ONLY", "NO_CONTENT_CACHE", "NO_ACCESS"]),
                campusId: z.enum(["tc", "duluth", "crookston", "morris", "rochester"]),
                dataClassification: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]),
                durationMs: z.number().int().min(0).max(120000),
                failureCode: z.null(),
                freshnessState: z.enum(["FRESH", "STALE", "EXPIRED", "UNKNOWN"]),
                httpStatus: z.number().int().min(200).max(299),
                licenseStatus: z.enum([
                  "OPEN_REUSE",
                  "LIVE_ONLY",
                  "DEEPLINK_ONLY",
                  "APPROVAL_REQUIRED",
                  "PROHIBITED",
                ]),
                observationId: z
                  .string()
                  .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
                observedAt: z.iso.datetime({ offset: true }),
                outcome: z.literal("SUCCESS"),
                parserVersion: z.string().regex(new RegExp("^[a-z0-9][a-z0-9._@/-]{0,127}$")),
                rawByteLength: z.number().int().min(0).max(10485760),
                rawSha256: z.string().regex(new RegExp("^[a-f0-9]{64}$")),
                recordsAccepted: z.number().int().min(0).max(1000000),
                recordsRejected: z.number().int().min(0).max(1000000),
                sourceId: z.string().regex(new RegExp("^[a-z0-9][a-z0-9-]{2,127}$")),
              })
              .strict(),
          )
          .min(1)
          .max(1),
      })
      .strict(),
  },
  listCampuses: {
    "200": z.array(
      z
        .object({
          academicCalendarCampusId: z.enum(["tc", "duluth", "crookston", "morris", "rochester"]),
          academicInstitutionCode: z.enum(["UMNTC", "UMNDL", "UMNCR", "UMNMO"]),
          city: z
            .object({
              en: z.string().min(1),
              "zh-CN": z.string().min(1),
            })
            .strict(),
          id: z.enum(["tc", "duluth", "crookston", "morris", "rochester"]),
          name: z
            .object({
              en: z.string().min(1),
              "zh-CN": z.string().min(1),
            })
            .strict(),
          officialStatus: z.enum(["UNVERIFIED", "PUBLISHER_ASSERTED", "PARTNERSHIP_VERIFIED"]),
          sourceUrl: z.url().regex(new RegExp("^https://")),
          timeZone: z.string(),
        })
        .strict(),
    ),
  },
  listEvents: {
    "200": z
      .object({
        items: z
          .array(
            z
              .object({
                allDay: z.boolean(),
                campusId: z.enum(["tc", "duluth", "crookston", "morris", "rochester"]),
                canonicalUrl: z.url().regex(new RegExp("^https://")),
                categories: z.array(z.string().min(1).max(128)).max(32),
                descriptionText: z.union([z.string().max(20000), z.null()]),
                endsAt: z.union([z.iso.datetime({ offset: true }), z.null()]),
                id: z.string().regex(new RegExp("^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")),
                language: z.string().regex(new RegExp("^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")),
                location: z.union([
                  z
                    .object({
                      address: z.union([z.string().max(1024), z.null()]),
                      coordinates: z.union([z.array(z.number()).min(2).max(2), z.null()]),
                      name: z.union([z.string().max(512), z.null()]),
                      onlineUrl: z.union([z.url().regex(new RegExp("^https://")), z.null()]),
                    })
                    .strict()
                    .refine(
                      (value) =>
                        !(
                          Object.hasOwn(value, "name") &&
                          Object.hasOwn(value, "address") &&
                          Object.hasOwn(value, "coordinates") &&
                          Object.hasOwn(value, "onlineUrl") &&
                          (!Object.hasOwn(value, "name") || value["name"] === null) &&
                          (!Object.hasOwn(value, "address") || value["address"] === null) &&
                          (!Object.hasOwn(value, "coordinates") || value["coordinates"] === null) &&
                          (!Object.hasOwn(value, "onlineUrl") || value["onlineUrl"] === null)
                        ) || false,
                      {
                        message:
                          "Conditional constraint from listEvents.responses.200.application/json.properties.items.items.properties.location.object.allOf[0] failed",
                      },
                    ),
                  z.null(),
                ]),
                observedAt: z.iso.datetime({ offset: true }),
                sourceId: z.string().regex(new RegExp("^[a-z0-9][a-z0-9-]{2,127}$")),
                sourceObservationId: z
                  .string()
                  .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
                startsAt: z.iso.datetime({ offset: true }),
                status: z.enum(["SCHEDULED", "POSTPONED", "CANCELLED"]),
                timeZone: z.string().min(1).max(128),
                title: z.string().min(1).max(1024),
              })
              .strict(),
          )
          .max(100),
        nextCursor: z.union([
          z.string().min(45).max(1994).regex(new RegExp("^[A-Za-z0-9_-]{1,1950}\\.[A-Za-z0-9_-]{43}$")),
          z.null(),
        ]),
        range: z
          .object({
            defaulted: z.boolean(),
            from: z.string().regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")),
            to: z.string().regex(new RegExp("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")),
          })
          .strict(),
        retrievalCoverage: z
          .object({
            nextUpstreamPage: z.union([z.number().int().min(1).max(20), z.null()]),
            pagesFetched: z.number().int().min(1).max(3),
            recordsFetched: z.number().int().min(0).max(50000),
            sourceTotalPages: z.number().int().min(0),
            sourceTotalRecords: z.number().int().min(0),
            truncatedByPolicy: z.boolean(),
          })
          .strict(),
        sourceObservations: z
          .array(
            z
              .object({
                appliedCacheDisposition: z.enum([
                  "NO_ACCESS",
                  "DISCARDED_AFTER_RESPONSE",
                  "OPERATIONAL_METADATA_ONLY",
                  "CONTENT_CACHED",
                ]),
                cachePolicy: z.enum(["CACHE_ALLOWED", "METADATA_ONLY", "NO_CONTENT_CACHE", "NO_ACCESS"]),
                campusId: z.enum(["tc", "duluth", "crookston", "morris", "rochester"]),
                dataClassification: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]),
                durationMs: z.number().int().min(0).max(120000),
                failureCode: z.null(),
                freshnessState: z.enum(["FRESH", "STALE", "EXPIRED", "UNKNOWN"]),
                httpStatus: z.number().int().min(200).max(299),
                licenseStatus: z.enum([
                  "OPEN_REUSE",
                  "LIVE_ONLY",
                  "DEEPLINK_ONLY",
                  "APPROVAL_REQUIRED",
                  "PROHIBITED",
                ]),
                observationId: z
                  .string()
                  .regex(new RegExp("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")),
                observedAt: z.iso.datetime({ offset: true }),
                outcome: z.literal("SUCCESS"),
                parserVersion: z.string().regex(new RegExp("^[a-z0-9][a-z0-9._@/-]{0,127}$")),
                rawByteLength: z.number().int().min(0).max(10485760),
                rawSha256: z.string().regex(new RegExp("^[a-f0-9]{64}$")),
                recordsAccepted: z.number().int().min(0).max(1000000),
                recordsRejected: z.number().int().min(0).max(1000000),
                sourceId: z.string().regex(new RegExp("^[a-z0-9][a-z0-9-]{2,127}$")),
              })
              .strict(),
          )
          .min(1)
          .max(3),
      })
      .strict(),
  },
  listSources: {
    "200": z
      .object({
        items: z.array(
          z
            .object({
              attribution: z.string().min(1).max(2048),
              authorizationEvidenceUrl: z.union([z.url().regex(new RegExp("^https://")), z.null()]),
              cacheDisposition: z
                .object({
                  derivedArtifacts: z.enum(["PROHIBITED", "SAME_RETENTION", "SEPARATE_APPROVAL"]),
                  normalizedRecords: z.enum(["NEVER_STORE", "TRANSIENT_ONLY", "PERSIST_WITH_TTL"]),
                  rawResponse: z.enum(["NEVER_STORE", "TRANSIENT_ONLY", "PERSIST_WITH_TTL"]),
                  retentionSeconds: z.union([z.number().int().min(1).max(31536000), z.null()]),
                })
                .strict(),
              cachePolicy: z.enum(["CACHE_ALLOWED", "METADATA_ONLY", "NO_CONTENT_CACHE", "NO_ACCESS"]),
              campusIds: z
                .array(z.enum(["tc", "duluth", "crookston", "morris", "rochester"]))
                .min(1)
                .max(5),
              dataClasses: z
                .array(
                  z.enum([
                    "PUBLIC_METADATA",
                    "COPYRIGHTED_CONTENT",
                    "PRECISE_LOCATION",
                    "PERSONAL_DATA",
                    "SENSITIVE_DATA",
                    "SAFETY_CRITICAL",
                    "MEDIA",
                  ]),
                )
                .min(1)
                .max(7),
              dataClassification: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"]),
              freshnessState: z.enum(["FRESH", "STALE", "EXPIRED", "UNKNOWN"]),
              id: z.string().regex(new RegExp("^[a-z0-9][a-z0-9-]{2,127}$")),
              killSwitch: z
                .object({
                  defaultState: z.enum(["ENABLED", "DISABLED"]),
                  fallback: z.enum(["DEEPLINK_ONLY", "UNAVAILABLE"]),
                  key: z.string().regex(new RegExp("^source\\.[a-z0-9][a-z0-9.-]{2,127}\\.enabled$")),
                })
                .strict(),
              lastCheckedAt: z.union([z.iso.datetime({ offset: true }), z.null()]),
              licenseEvidenceUrl: z.union([z.url().regex(new RegExp("^https://")), z.null()]),
              licenseStatus: z.enum([
                "OPEN_REUSE",
                "LIVE_ONLY",
                "DEEPLINK_ONLY",
                "APPROVAL_REQUIRED",
                "PROHIBITED",
              ]),
              name: z
                .object({
                  en: z.string().min(1),
                  "zh-CN": z.string().min(1),
                })
                .strict(),
              officialStatus: z.enum(["UNVERIFIED", "PUBLISHER_ASSERTED", "PARTNERSHIP_VERIFIED"]),
              owner: z
                .object({
                  contactUrl: z.url().regex(new RegExp("^https://")),
                  teamId: z.string().regex(new RegExp("^[a-z0-9][a-z0-9-]{2,63}$")),
                })
                .strict(),
              publisher: z.string().min(1).max(256),
              resourceKinds: z
                .array(z.enum(["CAMPUS_DEEPLINK", "ACADEMIC_SESSION", "PUBLIC_EVENT"]))
                .min(1)
                .max(3),
              sourceUrl: z.url().regex(new RegExp("^https://")),
              termsReviewedAt: z.union([z.iso.datetime({ offset: true }), z.null()]),
              termsReviewExpiresAt: z.union([z.iso.datetime({ offset: true }), z.null()]),
              verificationState: z.enum(["schematic", "surveyed", "campus-reviewed", "verified", "retired"]),
            })
            .strict()
            .refine(
              (value) =>
                !(
                  Object.hasOwn(value, "licenseStatus") &&
                  (!Object.hasOwn(value, "licenseStatus") || value["licenseStatus"] === "PROHIBITED")
                ) ||
                ((!Object.hasOwn(value, "cachePolicy") || value["cachePolicy"] === "NO_ACCESS") &&
                  (!Object.hasOwn(value, "termsReviewedAt") || value["termsReviewedAt"] === null) &&
                  (!Object.hasOwn(value, "termsReviewExpiresAt") || value["termsReviewExpiresAt"] === null)),
              {
                message:
                  "Conditional constraint from listSources.responses.200.application/json.properties.items.items.allOf[0] failed",
              },
            )
            .refine(
              (value) =>
                !(
                  Object.hasOwn(value, "licenseStatus") &&
                  (!Object.hasOwn(value, "licenseStatus") || value["licenseStatus"] === "APPROVAL_REQUIRED")
                ) ||
                ((!Object.hasOwn(value, "cachePolicy") || value["cachePolicy"] === "NO_ACCESS") &&
                  (!Object.hasOwn(value, "termsReviewedAt") || value["termsReviewedAt"] === null) &&
                  (!Object.hasOwn(value, "termsReviewExpiresAt") || value["termsReviewExpiresAt"] === null)),
              {
                message:
                  "Conditional constraint from listSources.responses.200.application/json.properties.items.items.allOf[1] failed",
              },
            )
            .refine(
              (value) =>
                !(
                  Object.hasOwn(value, "licenseStatus") &&
                  (!Object.hasOwn(value, "licenseStatus") || value["licenseStatus"] === "LIVE_ONLY")
                ) ||
                ((!Object.hasOwn(value, "authorizationEvidenceUrl") ||
                  typeof value["authorizationEvidenceUrl"] === "string") &&
                  (!Object.hasOwn(value, "termsReviewedAt") ||
                    typeof value["termsReviewedAt"] === "string") &&
                  (!Object.hasOwn(value, "termsReviewExpiresAt") ||
                    typeof value["termsReviewExpiresAt"] === "string")),
              {
                message:
                  "Conditional constraint from listSources.responses.200.application/json.properties.items.items.allOf[2] failed",
              },
            )
            .refine(
              (value) =>
                !(
                  Object.hasOwn(value, "termsReviewedAt") &&
                  (!Object.hasOwn(value, "termsReviewedAt") || value["termsReviewedAt"] === null)
                ) ||
                !Object.hasOwn(value, "termsReviewExpiresAt") ||
                value["termsReviewExpiresAt"] === null,
              {
                message:
                  "Conditional constraint from listSources.responses.200.application/json.properties.items.items.allOf[3] failed",
              },
            )
            .refine(
              (value) =>
                !(
                  Object.hasOwn(value, "termsReviewExpiresAt") &&
                  (!Object.hasOwn(value, "termsReviewExpiresAt") || value["termsReviewExpiresAt"] === null)
                ) ||
                !Object.hasOwn(value, "termsReviewedAt") ||
                value["termsReviewedAt"] === null,
              {
                message:
                  "Conditional constraint from listSources.responses.200.application/json.properties.items.items.allOf[4] failed",
              },
            ),
        ),
        nextCursor: z.union([z.string(), z.null()]),
      })
      .strict(),
  },
} satisfies Record<ImplementedOperationId, Readonly<Record<number, z.ZodType>>>;

const schemasByOperation: Readonly<Partial<Record<OperationId, Readonly<Record<number, z.ZodType>>>>> =
  implementedSuccessSchemas;

export type SuccessBodyValidationFailureReason =
  | "invalid-success-body"
  | "operation-not-implemented"
  | "unexpected-success-status";

export type SuccessBodyValidationResult =
  | { readonly success: true; readonly data: unknown }
  | { readonly success: false; readonly reason: SuccessBodyValidationFailureReason };

export function validateImplementedSuccessBody(
  operationId: OperationId,
  status: number,
  value: unknown,
): SuccessBodyValidationResult {
  const statusSchemas = schemasByOperation[operationId];
  if (statusSchemas === undefined) {
    return { success: false, reason: "operation-not-implemented" };
  }
  const schema = statusSchemas[status];
  if (schema === undefined) {
    return { success: false, reason: "unexpected-success-status" };
  }
  const result = schema.safeParse(value);
  return result.success
    ? { success: true, data: result.data }
    : { success: false, reason: "invalid-success-body" };
}
