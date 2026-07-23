import { describe, expect, it } from "vitest";

import { trustedProxySetting } from "../src/http/fastify-adapter.js";

describe("Fastify trusted proxy policy", () => {
  it("ignores forwarding headers unless explicit proxy ranges are configured", () => {
    expect(trustedProxySetting({})).toBe(false);
    expect(trustedProxySetting({ API_TRUSTED_PROXY_CIDRS: "10.0.0.0/8,fd00::/8,192.0.2.10" })).toEqual([
      "10.0.0.0/8",
      "fd00::/8",
      "192.0.2.10",
    ]);
  });

  it.each([
    { TRUST_PROXY: "true" },
    { API_TRUSTED_PROXY_CIDRS: "" },
    { API_TRUSTED_PROXY_CIDRS: " 10.0.0.0/8" },
    { API_TRUSTED_PROXY_CIDRS: "10.0.0.0/33" },
    { API_TRUSTED_PROXY_CIDRS: "fd00::/129" },
    { API_TRUSTED_PROXY_CIDRS: "10.0.0.0/8,10.0.0.0/8" },
    { API_TRUSTED_PROXY_CIDRS: "not-an-address" },
  ])("fails closed on unsafe proxy configuration %#", (environment) => {
    expect(() => trustedProxySetting(environment)).toThrow();
  });
});
