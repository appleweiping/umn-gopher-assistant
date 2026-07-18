import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const openapi = readFileSync(resolve(import.meta.dirname, "../../../openapi/openapi.yaml"), "utf8");

describe("OpenAPI source policy invariants", () => {
  it("requires prohibited source descriptors to use NO_ACCESS", () => {
    expect(openapi).toMatch(
      /SourceDescriptor:[\s\S]*?allOf:[\s\S]*?if:[\s\S]*?licenseStatus:[\s\S]*?const: PROHIBITED[\s\S]*?then:[\s\S]*?cachePolicy:[\s\S]*?const: NO_ACCESS/u,
    );
  });

  it("requires an admin prohibition update to set NO_ACCESS atomically", () => {
    expect(openapi).toMatch(
      /AdminSourcePolicyUpdate:[\s\S]*?allOf:[\s\S]*?if:[\s\S]*?licenseStatus:[\s\S]*?const: PROHIBITED[\s\S]*?then:[\s\S]*?required: \[cachePolicy\][\s\S]*?cachePolicy:[\s\S]*?const: NO_ACCESS/u,
    );
  });
});
