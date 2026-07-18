import { Injectable } from "@nestjs/common";
import { campuses } from "@umn-gopher-assistant/config";
import {
  CampusWorldManifestSchema,
  type CampusId,
  type CampusWorldManifest,
} from "@umn-gopher-assistant/contracts";

import type { WorldManifestRepository } from "./ports.js";

const worldManifests = new Map<CampusId, CampusWorldManifest>(
  campuses.map((campus) => {
    const worldVersion = `${campus.id}-schematic-v1`;
    const manifest = CampusWorldManifestSchema.parse({
      campusId: campus.id,
      worldVersion,
      revision: 1,
      generatedAt: "2026-07-19T00:00:00.000Z",
      verificationState: "schematic",
      etag: `"${worldVersion}-r1"`,
      sourceIds: [`${campus.id}-campus-home`],
      tiles: [],
      portals: [],
    });
    return [campus.id, manifest];
  }),
);

@Injectable()
export class InMemoryWorldManifestRepository implements WorldManifestRepository {
  findByCampusId(campusId: string): Promise<CampusWorldManifest | null> {
    return Promise.resolve(worldManifests.get(campusId as CampusId) ?? null);
  }
}
