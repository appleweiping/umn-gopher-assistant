import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  auditEvents,
  campuses,
  outboxEvents,
  sourceSnapshots,
  sources,
  worldManifests,
} from "../src/schema.js";

describe("foundation database schema", () => {
  it("exposes the service-owned foundation tables", () => {
    expect(
      [campuses, sources, sourceSnapshots, outboxEvents, worldManifests, auditEvents].map(getTableName),
    ).toEqual([
      "campuses",
      "sources",
      "source_snapshots",
      "outbox_events",
      "world_manifests",
      "audit_events",
    ]);
  });
});
