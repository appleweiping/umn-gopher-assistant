import { describe, expect, it } from "vitest";

import { isKnownUnsafeAppleWebKitVault } from "../lib/personal-vault/webkit-safety";

describe("Apple WebKit vault persistence safety gate", () => {
  it.each([
    [
      "Safari 18.6",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
    ],
    [
      "Chrome on iOS 18.6",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0 Mobile/15E148 Safari/604.1",
    ],
    ["unknown embedded Apple WebKit", "Mozilla/5.0 AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"],
  ])("fails closed for %s", (_name, userAgent) => {
    expect(isKnownUnsafeAppleWebKitVault(userAgent)).toBe(true);
  });

  it.each([
    [
      "Safari 26",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/620.5.1 (KHTML, like Gecko) Version/26.0 Safari/620.5.1",
    ],
    [
      "iOS 26 Safari",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/620.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
    ],
    [
      "desktop Chrome",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    ],
    ["Firefox", "Mozilla/5.0 Firefox/141.0"],
  ])("allows %s", (_name, userAgent) => {
    expect(isKnownUnsafeAppleWebKitVault(userAgent)).toBe(false);
  });
});
