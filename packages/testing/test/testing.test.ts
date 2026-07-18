import { describe, expect, it } from "vitest";
import { z } from "zod";

import { expectSchemaFailure, expectSchemaSuccess } from "../src/index.js";

describe("schema test helpers", () => {
  const schema = z.object({ value: z.string().min(1) });

  it("returns parsed data for a successful schema", () => {
    expect(expectSchemaSuccess(schema, { value: "ok" })).toEqual({ value: "ok" });
  });

  it("returns issues for a failed schema", () => {
    expect(expectSchemaFailure(schema, { value: "" }).length).toBeGreaterThan(0);
  });
});
