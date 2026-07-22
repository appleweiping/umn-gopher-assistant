// @vitest-environment node

import { describe, expect, it } from "vitest";

import { isSignedCatalogCursor } from "../lib/catalog/cursor";

describe("signed catalog cursor", () => {
  it("requires one bounded payload, one separator, and a 43-character base64url HMAC", () => {
    expect(isSignedCatalogCursor(`${"a".repeat(1)}.${"B".repeat(43)}`)).toBe(true);
    expect(isSignedCatalogCursor(`${"a".repeat(1950)}.${"_".repeat(43)}`)).toBe(true);
    expect(isSignedCatalogCursor(`${"a".repeat(1951)}.${"b".repeat(43)}`)).toBe(false);
    expect(isSignedCatalogCursor(`${"a".repeat(12)}.${"b".repeat(42)}`)).toBe(false);
    expect(isSignedCatalogCursor(`${"a".repeat(12)}..${"b".repeat(43)}`)).toBe(false);
    expect(isSignedCatalogCursor("unsigned-cursor")).toBe(false);
  });
});
