import { z } from "zod";

import {
  CampusIdSchema,
  FreshnessStateSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  VerificationStateSchema,
} from "./common.js";
import { SourceIdSchema } from "./source.js";

const HTML_OR_ENTITY = /[<>]|&(?:#(?:[xX][0-9A-Fa-f]+|\d+)|[A-Za-z][A-Za-z0-9]{1,31});?/u;
const UNSAFE_UNICODE = /[\p{Cc}\p{Cf}\p{Cs}]/u;

const OfficialCampusUrlSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    (hostname !== "umn.edu" && !hostname.endsWith(".umn.edu")) ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" && url.port !== "443") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    context.addIssue({
      code: "custom",
      message: "Expected a credential-free canonical HTTPS URL on an official umn.edu host",
    });
  }
});

const SafeQueryTextSchema = z
  .string()
  .trim()
  .min(2)
  .max(500)
  .refine((value) => value.normalize("NFC") === value, "Query must use NFC Unicode normalization")
  .refine((value) => !UNSAFE_UNICODE.test(value), "Query cannot contain control or format characters")
  .refine((value) => !HTML_OR_ENTITY.test(value), "Query cannot contain HTML or encoded HTML");
const EvidenceIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);

function safeEvidenceText(maximumLength: number) {
  return z
    .string()
    .min(1)
    .max(maximumLength)
    .refine((value) => value === value.trim(), "Evidence text cannot have boundary whitespace")
    .refine((value) => value.normalize("NFC") === value, "Evidence text must use NFC Unicode normalization")
    .refine(
      (value) => !UNSAFE_UNICODE.test(value),
      "Evidence text cannot contain control or format characters",
    )
    .refine((value) => !HTML_OR_ENTITY.test(value), "Evidence text cannot contain HTML or encoded HTML");
}

const EvidenceTextSchema = safeEvidenceText(4_000);
const EvidenceTitleSchema = z
  .object({
    en: safeEvidenceText(2_000),
    "zh-CN": safeEvidenceText(2_000),
  })
  .strict();

export const AiLocaleSchema = z.enum(["en", "zh-CN"]);
export type AiLocale = z.infer<typeof AiLocaleSchema>;

export const AiQueryStateSchema = z.enum(["answered", "stale", "conflict", "no-results"]);
export type AiQueryState = z.infer<typeof AiQueryStateSchema>;

export const AiCitationCategorySchema = z.enum([
  "library",
  "student-services",
  "safety",
  "transportation",
  "dining",
]);
export type AiCitationCategory = z.infer<typeof AiCitationCategorySchema>;

export const AiQueryRequestSchema = z
  .object({
    campusId: CampusIdSchema,
    locale: AiLocaleSchema,
    query: SafeQueryTextSchema,
  })
  .strict();
export type AiQueryRequest = z.infer<typeof AiQueryRequestSchema>;

export const AiAnswerParagraphSchema = z
  .object({
    id: EvidenceIdSchema,
    text: EvidenceTextSchema,
    citationIds: z.array(EvidenceIdSchema).min(1).max(64),
  })
  .strict()
  .refine((paragraph) => new Set(paragraph.citationIds).size === paragraph.citationIds.length, {
    message: "citationIds must be unique within a paragraph",
    path: ["citationIds"],
  });
export type AiAnswerParagraph = z.infer<typeof AiAnswerParagraphSchema>;

export const AiCitationSchema = z
  .object({
    id: EvidenceIdSchema,
    campusId: CampusIdSchema,
    sourceId: SourceIdSchema,
    category: AiCitationCategorySchema,
    title: EvidenceTitleSchema,
    sourceUrl: OfficialCampusUrlSchema,
    contentSha256: Sha256Schema,
    updatedAt: IsoDateTimeSchema,
    freshnessState: FreshnessStateSchema,
    verificationState: VerificationStateSchema,
    excerpt: EvidenceTextSchema,
  })
  .strict();
export type AiCitation = z.infer<typeof AiCitationSchema>;

export const AiRetrievalSchema = z
  .object({
    mode: z.literal("no-key-hybrid"),
    documentsConsidered: z.number().int().nonnegative().max(1_000_000),
  })
  .strict();
export type AiRetrieval = z.infer<typeof AiRetrievalSchema>;

export const AiQueryResponseSchema = z
  .object({
    state: AiQueryStateSchema,
    queryId: z.uuid(),
    campusId: CampusIdSchema,
    locale: AiLocaleSchema,
    paragraphs: z.array(AiAnswerParagraphSchema).max(64),
    citations: z.array(AiCitationSchema).max(128),
    retrieval: AiRetrievalSchema,
  })
  .strict()
  .superRefine((response, context) => {
    const paragraphIds = response.paragraphs.map((paragraph) => paragraph.id);
    if (new Set(paragraphIds).size !== paragraphIds.length) {
      context.addIssue({ code: "custom", message: "paragraph ids must be unique", path: ["paragraphs"] });
    }

    const citationIds = response.citations.map((citation) => citation.id);
    if (new Set(citationIds).size !== citationIds.length) {
      context.addIssue({ code: "custom", message: "citation ids must be unique", path: ["citations"] });
    }

    const knownCitationIds = new Set(citationIds);
    const referencedCitationIds = new Set<string>();
    response.paragraphs.forEach((paragraph, paragraphIndex) => {
      paragraph.citationIds.forEach((citationId, citationIndex) => {
        referencedCitationIds.add(citationId);
        if (!knownCitationIds.has(citationId)) {
          context.addIssue({
            code: "custom",
            message: "paragraph citationIds must reference citations in this response",
            path: ["paragraphs", paragraphIndex, "citationIds", citationIndex],
          });
        }
      });
    });

    response.citations.forEach((citation, citationIndex) => {
      if (citation.campusId !== response.campusId) {
        context.addIssue({
          code: "custom",
          message: "cross-campus citations are not allowed",
          path: ["citations", citationIndex, "campusId"],
        });
      }
      if (!referencedCitationIds.has(citation.id)) {
        context.addIssue({
          code: "custom",
          message: "every citation must support at least one answer paragraph",
          path: ["citations", citationIndex, "id"],
        });
      }
      if (citation.verificationState === "retired") {
        context.addIssue({
          code: "custom",
          message: "retired evidence cannot be cited",
          path: ["citations", citationIndex, "verificationState"],
        });
      }
      if (citation.freshnessState === "UNKNOWN") {
        context.addIssue({
          code: "custom",
          message: "evidence with unknown freshness cannot be cited",
          path: ["citations", citationIndex, "freshnessState"],
        });
      }
    });

    if (response.state === "no-results") {
      if (response.paragraphs.length !== 0) {
        context.addIssue({
          code: "custom",
          message: "no-results responses cannot contain answer paragraphs",
          path: ["paragraphs"],
        });
      }
      if (response.citations.length !== 0) {
        context.addIssue({
          code: "custom",
          message: "no-results responses cannot contain citations",
          path: ["citations"],
        });
      }
      return;
    }

    if (response.paragraphs.length === 0) {
      context.addIssue({
        code: "custom",
        message: `${response.state} responses require at least one evidence-backed paragraph`,
        path: ["paragraphs"],
      });
    }
    if (response.citations.length === 0) {
      context.addIssue({
        code: "custom",
        message: `${response.state} responses require at least one citation`,
        path: ["citations"],
      });
    }

    if (response.state === "answered") {
      response.citations.forEach((citation, citationIndex) => {
        if (citation.freshnessState !== "FRESH") {
          context.addIssue({
            code: "custom",
            message: "answered responses may cite only FRESH evidence",
            path: ["citations", citationIndex, "freshnessState"],
          });
        }
      });
    }

    if (response.state === "stale") {
      response.citations.forEach((citation, citationIndex) => {
        if (citation.freshnessState !== "STALE" && citation.freshnessState !== "EXPIRED") {
          context.addIssue({
            code: "custom",
            message: "stale responses may cite only STALE or EXPIRED evidence",
            path: ["citations", citationIndex, "freshnessState"],
          });
        }
      });
    }

    if (response.state === "conflict") {
      if (response.citations.length < 2) {
        context.addIssue({
          code: "custom",
          message: "conflict responses require at least two citations",
          path: ["citations"],
        });
      }
      if (new Set(response.citations.map((citation) => citation.sourceId)).size < 2) {
        context.addIssue({
          code: "custom",
          message: "conflict responses require at least two distinct sources",
          path: ["citations"],
        });
      }
      if (new Set(response.citations.map((citation) => citation.contentSha256)).size < 2) {
        context.addIssue({
          code: "custom",
          message: "conflict responses require genuinely different evidence",
          path: ["citations"],
        });
      }
    }
  });
export type AiQueryResponse = z.infer<typeof AiQueryResponseSchema>;
