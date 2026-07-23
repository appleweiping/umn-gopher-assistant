import { describe, expect, it } from "vitest";

import { derivePrivacyNetworkId } from "../src/network-token.js";

const KEY = Buffer.alloc(32, 0x35);
const DAY_ONE = Date.UTC(2026, 6, 23, 12);
const DAY_TWO = Date.UTC(2026, 6, 24, 0);

describe("privacy-preserving network identifiers", () => {
  it("groups IPv4 peers by /24 and treats IPv4-mapped IPv6 identically", () => {
    const expected = derivePrivacyNetworkId("192.0.2.17", KEY, DAY_ONE);
    expect(derivePrivacyNetworkId("192.0.2.240", KEY, DAY_ONE)).toBe(expected);
    expect(derivePrivacyNetworkId("::ffff:192.0.2.99", KEY, DAY_ONE)).toBe(expected);
    expect(derivePrivacyNetworkId("::ffff:c000:0263", KEY, DAY_ONE)).toBe(expected);
    expect(derivePrivacyNetworkId("192.0.3.17", KEY, DAY_ONE)).not.toBe(expected);
  });

  it("groups IPv6 peers by /64 without exposing the address", () => {
    const expected = derivePrivacyNetworkId("2001:db8:abcd:1234::1", KEY, DAY_ONE);
    expect(derivePrivacyNetworkId("2001:db8:abcd:1234:ffff::beef", KEY, DAY_ONE)).toBe(expected);
    expect(derivePrivacyNetworkId("2001:db8:abcd:1235::1", KEY, DAY_ONE)).not.toBe(expected);
    expect(expected).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(expected).not.toContain("2001");
  });

  it("rotates at the UTC day boundary and is stable within a day", () => {
    const address = "198.51.100.42";
    expect(derivePrivacyNetworkId(address, KEY, DAY_ONE + 60_000)).toBe(
      derivePrivacyNetworkId(address, KEY, DAY_ONE),
    );
    expect(derivePrivacyNetworkId(address, KEY, DAY_TWO)).not.toBe(
      derivePrivacyNetworkId(address, KEY, DAY_ONE),
    );
  });

  it("rejects non-IP peers and invalid key or clock material", () => {
    expect(() => derivePrivacyNetworkId("not-an-ip", KEY, DAY_ONE)).toThrow(TypeError);
    expect(() => derivePrivacyNetworkId("2001:db8::1::2", KEY, DAY_ONE)).toThrow(TypeError);
    expect(() => derivePrivacyNetworkId("192.0.2.1", Buffer.alloc(31), DAY_ONE)).toThrow(TypeError);
    expect(() => derivePrivacyNetworkId("192.0.2.1", KEY, Number.NaN)).toThrow(TypeError);
  });
});
