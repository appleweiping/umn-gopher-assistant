import { z } from "zod";

import { BilingualTextSchema, CampusIdSchema, OfficialStatusSchema } from "./common.js";
import type { CampusId } from "./common.js";

export const AcademicInstitutionCodeSchema = z.enum(["UMNTC", "UMNDL", "UMNCR", "UMNMO"]);
export type AcademicInstitutionCode = z.infer<typeof AcademicInstitutionCodeSchema>;

export const CampusMetadataSchema = z
  .object({
    id: CampusIdSchema,
    name: BilingualTextSchema,
    city: BilingualTextSchema,
    timeZone: z.string().min(1),
    academicInstitutionCode: AcademicInstitutionCodeSchema,
    academicCalendarCampusId: CampusIdSchema,
    sourceUrl: z.url().refine((url) => url.startsWith("https://"), "Expected an HTTPS URL"),
    officialStatus: OfficialStatusSchema,
  })
  .strict();
export type CampusMetadata = z.infer<typeof CampusMetadataSchema>;

export const ACADEMIC_CALENDAR_CAMPUS_MAP = Object.freeze({
  tc: "tc",
  duluth: "duluth",
  crookston: "crookston",
  morris: "morris",
  rochester: "tc",
} satisfies Record<CampusId, CampusId>);

export const CAMPUS_ACADEMIC_INSTITUTION_MAP = Object.freeze({
  tc: "UMNTC",
  duluth: "UMNDL",
  crookston: "UMNCR",
  morris: "UMNMO",
  rochester: "UMNTC",
} satisfies Record<CampusId, AcademicInstitutionCode>);

export function resolveAcademicCalendarCampus(campusId: CampusId): CampusId {
  return ACADEMIC_CALENDAR_CAMPUS_MAP[campusId];
}

export function resolveAcademicInstitution(campusId: CampusId): AcademicInstitutionCode {
  return CAMPUS_ACADEMIC_INSTITUTION_MAP[campusId];
}
