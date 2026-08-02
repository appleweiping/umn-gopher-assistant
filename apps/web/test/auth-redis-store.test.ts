// @vitest-environment node

import { describe, expect, it } from "vitest";

import { sessionStoreKeysForTesting } from "../lib/auth/redis-store";

function clusterHashTag(key: string): string | undefined {
  return /\{([^{}]+)\}/u.exec(key)?.[1];
}

describe("web auth Redis key contract", () => {
  it("places a session record, resource nonce, and refresh lease in one cluster slot", () => {
    const firstId = Buffer.alloc(32, 61).toString("base64url");
    const secondId = Buffer.alloc(32, 62).toString("base64url");
    const firstKeys = sessionStoreKeysForTesting(firstId);
    const firstTags = firstKeys.map(clusterHashTag);

    expect(firstKeys).toHaveLength(3);
    expect(firstTags.every((tag) => typeof tag === "string" && tag.length === 43)).toBe(true);
    expect(new Set(firstTags).size).toBe(1);
    expect(clusterHashTag(sessionStoreKeysForTesting(secondId)[0] ?? "")).not.toBe(firstTags[0]);
    expect(firstKeys.join("\n")).not.toContain(firstId);
  });
});
