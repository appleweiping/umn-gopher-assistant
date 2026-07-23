import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadGatewayRuntimeConfig } from "../src/config.js";

const KEY_ONE = Buffer.alloc(32, 0x11).toString("base64url");
const KEY_TWO = Buffer.alloc(32, 0x22).toString("base64url");
const LOCAL_ASSERTION_KEY = Buffer.from("development-only-ai-ingress-network-hmac-key-v1", "utf8").toString(
  "base64url",
);
const LOCAL_NETWORK_KEY = Buffer.from("development-only-edge-ai-network-hmac-key-v1", "utf8").toString(
  "base64url",
);

function productionEnvironment(): Record<string, string> {
  return {
    EDGE_GATEWAY_NETWORK_HMAC_KEY: KEY_ONE,
    EDGE_GATEWAY_PUBLIC_ORIGIN: "https://assistant.example.edu",
    EDGE_GATEWAY_TLS_CERT_FILE: resolve("gateway-test.crt"),
    EDGE_GATEWAY_TLS_KEY_FILE: resolve("gateway-test.key"),
    EDGE_GATEWAY_TLS_MODE: "direct",
    EDGE_GATEWAY_WEB_ORIGIN: "http://web.internal:3000",
    GOPHER_AI_INGRESS_ASSERTION_HMAC_KEY: KEY_TWO,
    NODE_ENV: "production",
  };
}

describe("edge gateway runtime configuration", () => {
  it("provides fixed local-only defaults for reproducible development", () => {
    const config = loadGatewayRuntimeConfig({ NODE_ENV: "test" });
    expect(config.webOrigin.href).toBe("http://127.0.0.1:3000/");
    expect(config.tls.mode).toBe("disabled");
    expect(config.listenHost).toBe("127.0.0.1");
    expect(config.readinessPath).toBe("/");
  });

  it("requires direct TLS, an HTTPS public origin, and independent canonical keys in production", () => {
    const config = loadGatewayRuntimeConfig(productionEnvironment());
    expect(config.production).toBe(true);
    expect(config.publicOrigin?.href).toBe("https://assistant.example.edu/");
    expect(config.tls.mode).toBe("direct");

    const missingKey = productionEnvironment();
    delete missingKey["EDGE_GATEWAY_NETWORK_HMAC_KEY"];
    expect(() => loadGatewayRuntimeConfig(missingKey)).toThrow(/EDGE_GATEWAY_NETWORK_HMAC_KEY/u);

    expect(() =>
      loadGatewayRuntimeConfig({
        ...productionEnvironment(),
        EDGE_GATEWAY_NETWORK_HMAC_KEY: KEY_TWO,
      }),
    ).toThrow(/independent/u);
    expect(() =>
      loadGatewayRuntimeConfig({
        ...productionEnvironment(),
        EDGE_GATEWAY_PUBLIC_ORIGIN: "http://assistant.example.edu",
      }),
    ).toThrow(/EDGE_GATEWAY_PUBLIC_ORIGIN/u);
    expect(() =>
      loadGatewayRuntimeConfig({
        ...productionEnvironment(),
        EDGE_GATEWAY_TLS_MODE: "disabled",
      }),
    ).toThrow(/direct/u);
    expect(() =>
      loadGatewayRuntimeConfig({
        ...productionEnvironment(),
        GOPHER_AI_INGRESS_ASSERTION_HMAC_KEY: LOCAL_ASSERTION_KEY,
      }),
    ).toThrow(/fixed development key/u);
    expect(() =>
      loadGatewayRuntimeConfig({
        ...productionEnvironment(),
        EDGE_GATEWAY_NETWORK_HMAC_KEY: LOCAL_NETWORK_KEY,
      }),
    ).toThrow(/fixed development key/u);
  });

  it("rejects credential-bearing or non-origin upstream URLs", () => {
    expect(() =>
      loadGatewayRuntimeConfig({
        EDGE_GATEWAY_WEB_ORIGIN: "http://user:password@web.internal:3000",
        NODE_ENV: "test",
      }),
    ).toThrow(/credential-free/u);
    expect(() =>
      loadGatewayRuntimeConfig({
        EDGE_GATEWAY_WEB_ORIGIN: "http://web.internal:3000/base",
        NODE_ENV: "test",
      }),
    ).toThrow(/credential-free/u);
  });

  it("bounds listener and upstream timeout settings", () => {
    expect(() =>
      loadGatewayRuntimeConfig({
        EDGE_GATEWAY_MAX_HEADER_BYTES: "1000000",
        NODE_ENV: "test",
      }),
    ).toThrow(/EDGE_GATEWAY_MAX_HEADER_BYTES/u);
    expect(() =>
      loadGatewayRuntimeConfig({
        EDGE_GATEWAY_HEADERS_TIMEOUT_MS: "20000",
        EDGE_GATEWAY_REQUEST_TIMEOUT_MS: "10000",
        NODE_ENV: "test",
      }),
    ).toThrow(/must not exceed/u);
    expect(() =>
      loadGatewayRuntimeConfig({
        EDGE_GATEWAY_LISTEN_HOST: " 0.0.0.0",
        NODE_ENV: "test",
      }),
    ).toThrow(/canonical IP/u);
    expect(() =>
      loadGatewayRuntimeConfig({
        EDGE_GATEWAY_WEB_READINESS_PATH: "//attacker.example",
        NODE_ENV: "test",
      }),
    ).toThrow(/bounded absolute path/u);
  });
});
