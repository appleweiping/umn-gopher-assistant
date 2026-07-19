/**
 * Generated from openapi/openapi.yaml. DO NOT EDIT.
 * Run `pnpm --filter @umn-gopher-assistant/sdk generate` after contract changes.
 */

import { z } from "zod";

import { operationDefinitions } from "./operations.js";
import type { OperationId } from "./operations.js";

export const successValidatorContractSha256 =
  "775a90cce98d564cb401c89145896ab05053683b831dceaf7480659f2a522389";

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
  listSources: {
    "200": z
      .object({
        items: z.array(
          z
            .object({
              attribution: z.string().min(1),
              cachePolicy: z.enum(["CACHE_ALLOWED", "METADATA_ONLY", "NO_CONTENT_CACHE", "NO_ACCESS"]),
              campusIds: z.array(z.enum(["tc", "duluth", "crookston", "morris", "rochester"])).min(1),
              freshnessState: z.enum(["FRESH", "STALE", "EXPIRED", "UNKNOWN"]),
              id: z.string(),
              lastCheckedAt: z.union([z.iso.datetime({ offset: true }), z.null()]),
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
              publisher: z.string(),
              sourceUrl: z.url().regex(new RegExp("^https://")),
              verificationState: z.enum(["schematic", "surveyed", "campus-reviewed", "verified", "retired"]),
            })
            .strict()
            .refine(
              (value) =>
                !(
                  Object.hasOwn(value, "licenseStatus") &&
                  (!Object.hasOwn(value, "licenseStatus") || value["licenseStatus"] === "PROHIBITED")
                ) ||
                !Object.hasOwn(value, "cachePolicy") ||
                value["cachePolicy"] === "NO_ACCESS",
              {
                message:
                  "Conditional constraint from listSources.responses.200.application/json.properties.items.items.allOf[0] failed",
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
