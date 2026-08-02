import { createHash, randomUUID } from "node:crypto";

import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { loadMcpServerConfig } from "../src/config.js";
import { DpopVerificationError, RedisDpopProofVerifier } from "../src/dpop.js";

const runRedisIntegration = process.env["DPOP_REDIS_INTEGRATION"] === "1";

describe.runIf(runRedisIntegration)("MCP RFC 9449 real Redis integration", () => {
  it("challenges, accepts a fresh nonce proof, and rejects replay", async () => {
    const pair = await generateKeyPair("ES256", { extractable: true });
    const publicJwk = await exportJWK(pair.publicKey);
    const jkt = await calculateJwkThumbprint(publicJwk, "sha256");
    const accessToken = `header.${"a".repeat(48)}.signature`;
    const config = loadMcpServerConfig({
      MCP_AUTH_MODE: "oauth",
      MCP_DPOP_REDIS_URL:
        process.env["MCP_DPOP_REDIS_URL"] ?? "redis://:local-redis-password-only@127.0.0.1:6379",
      MCP_OAUTH_ISSUER: "http://127.0.0.1:8080/realms/gopher-assistant-dev",
      MCP_RESOURCE_URL: "http://127.0.0.1:4100/mcp",
      NODE_ENV: "test",
    });
    const verifier = new RedisDpopProofVerifier(config);
    const identity = {
      clientId: "gopher-mcp",
      dpopJkt: jkt,
      expiresAt: Math.floor(Date.now() / 1_000) + 300,
      scopes: new Set(["campus:read"]),
      subject: `mcp-redis-smoke-${randomUUID()}`,
    };
    const proof = (jti: string, nonce?: string) =>
      new SignJWT({
        ath: createHash("sha256").update(accessToken, "ascii").digest("base64url"),
        htm: "POST",
        htu: "http://127.0.0.1:4100/mcp",
        iat: Math.floor(Date.now() / 1_000),
        jti,
        ...(nonce === undefined ? {} : { nonce }),
      })
        .setProtectedHeader({ alg: "ES256", jwk: publicJwk, typ: "dpop+jwt" })
        .sign(pair.privateKey);

    try {
      const concurrentChallenges = await Promise.allSettled([
        verifier.verify({
          accessToken,
          identity,
          method: "POST",
          proof: await proof("connect-短"),
        }),
        verifier.verify({
          accessToken,
          identity,
          method: "POST",
          proof: await proof("connect-😀"),
        }),
      ]);
      for (const result of concurrentChallenges) {
        expect(result.status).toBe("rejected");
        if (result.status === "rejected") {
          expect(result.reason).toBeInstanceOf(DpopVerificationError);
          expect(result.reason).toMatchObject({ kind: "nonce" });
        }
      }
      const firstChallenge = concurrentChallenges[0];
      const nonce =
        firstChallenge.status === "rejected" && firstChallenge.reason instanceof DpopVerificationError
          ? firstChallenge.reason.nonce
          : undefined;
      expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/u);

      const accepted = await proof("😀", nonce);
      await expect(
        verifier.verify({ accessToken, identity, method: "POST", proof: accepted }),
      ).resolves.toBeUndefined();
      await expect(
        verifier.verify({ accessToken, identity, method: "POST", proof: accepted }),
      ).rejects.toMatchObject({ kind: "invalid" });
      await expect(verifier.ready()).resolves.toBe(true);
    } finally {
      await verifier.close();
    }
  });
});

describe("MCP RFC 9449 proof parser boundaries", () => {
  it("rejects oversized compact proofs and remote key selectors before Redis", async () => {
    const pair = await generateKeyPair("ES256", { extractable: true });
    const publicJwk = await exportJWK(pair.publicKey);
    const jkt = await calculateJwkThumbprint(publicJwk, "sha256");
    const accessToken = `header.${"a".repeat(48)}.signature`;
    const config = loadMcpServerConfig({
      MCP_AUTH_MODE: "oauth",
      MCP_OAUTH_ISSUER: "http://127.0.0.1:8080/realms/gopher-assistant-dev",
      MCP_RESOURCE_URL: "http://127.0.0.1:4100/mcp",
      NODE_ENV: "test",
    });
    const verifier = new RedisDpopProofVerifier(config);
    const identity = {
      clientId: "gopher-mcp",
      dpopJkt: jkt,
      expiresAt: Math.floor(Date.now() / 1_000) + 300,
      scopes: new Set(["campus:read"]),
      subject: "parser-boundary",
    };
    const remoteKeyProof = await new SignJWT({
      ath: createHash("sha256").update(accessToken, "ascii").digest("base64url"),
      htm: "POST",
      htu: "http://127.0.0.1:4100/mcp",
      iat: Math.floor(Date.now() / 1_000),
      jti: randomUUID(),
    })
      .setProtectedHeader({
        alg: "ES256",
        jku: "https://attacker.example/jwks.json",
        jwk: publicJwk,
        typ: "dpop+jwt",
      })
      .sign(pair.privateKey);

    try {
      await expect(
        verifier.verify({
          accessToken,
          identity,
          method: "POST",
          proof: "a".repeat(16_385),
        }),
      ).rejects.toMatchObject({ kind: "invalid" });
      await expect(
        verifier.verify({
          accessToken,
          identity,
          method: "POST",
          proof: remoteKeyProof,
        }),
      ).rejects.toMatchObject({ kind: "invalid" });
    } finally {
      await verifier.close();
    }
  });
});
