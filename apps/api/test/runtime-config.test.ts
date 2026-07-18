import { describe, expect, it } from "vitest";

import { parsePort } from "../src/runtime-config.js";

describe("runtime configuration", () => {
  it("accepts only complete decimal ports in the TCP range", () => {
    expect(parsePort(undefined)).toBe(4000);
    expect(parsePort("1")).toBe(1);
    expect(parsePort("65535")).toBe(65_535);

    for (const invalid of ["", "0", "65536", "1.5", "4000garbage", "+4000", " 4000", "０４０００"]) {
      expect(() => parsePort(invalid), invalid).toThrow("PORT must be an integer between 1 and 65535");
    }
  });
});
