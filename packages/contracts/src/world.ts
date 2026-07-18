import { z } from "zod";

import {
  BilingualTextSchema,
  CampusIdSchema,
  GeographicPositionSchema,
  IsoDateTimeSchema,
  LicenseStatusSchema,
  Sha256Schema,
  VerificationStateSchema,
} from "./common.js";

const WorldBoundsSchema = z
  .tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ])
  .refine(
    ([west, south, east, north]) => west < east && south < north,
    "Bounds must be ordered west/south/east/north",
  );

export const WorldTileSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,127}$/u),
    url: z.url().refine((url) => url.startsWith("https://"), "Expected an HTTPS URL"),
    contentType: z.string().min(1),
    minZoom: z.number().int().min(0).max(24),
    maxZoom: z.number().int().min(0).max(24),
    bounds: WorldBoundsSchema,
    sha256: Sha256Schema,
    byteLength: z.number().int().positive(),
    licenseStatus: LicenseStatusSchema,
    verificationState: VerificationStateSchema,
  })
  .strict()
  .refine((tile) => tile.minZoom <= tile.maxZoom, {
    message: "minZoom must not exceed maxZoom",
    path: ["maxZoom"],
  });
export type WorldTile = z.infer<typeof WorldTileSchema>;

export const WorldPortalSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,127}$/u),
    label: BilingualTextSchema,
    fromCampusId: CampusIdSchema,
    toCampusId: CampusIdSchema,
    position: GeographicPositionSchema,
    targetWorldVersion: z.string().min(1),
    verificationState: VerificationStateSchema,
  })
  .strict()
  .refine((portal) => portal.fromCampusId !== portal.toCampusId, {
    message: "A portal must connect distinct campuses",
    path: ["toCampusId"],
  });
export type WorldPortal = z.infer<typeof WorldPortalSchema>;

export const CampusWorldManifestSchema = z
  .object({
    campusId: CampusIdSchema,
    worldVersion: z.string().min(1).max(128),
    revision: z.number().int().positive(),
    generatedAt: IsoDateTimeSchema,
    verificationState: VerificationStateSchema,
    etag: z.string().regex(/^(?:W\/)?"[^"\r\n]+"$/u),
    sourceIds: z.array(z.string().min(1)).min(1),
    tiles: z.array(WorldTileSchema),
    portals: z.array(WorldPortalSchema),
  })
  .strict()
  .superRefine((manifest, context) => {
    manifest.portals.forEach((portal, index) => {
      if (portal.fromCampusId !== manifest.campusId) {
        context.addIssue({
          code: "custom",
          message: "Portal origin must match manifest campus",
          path: ["portals", index, "fromCampusId"],
        });
      }
    });
  });
export type CampusWorldManifest = z.infer<typeof CampusWorldManifestSchema>;
