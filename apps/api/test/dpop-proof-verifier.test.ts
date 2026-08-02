import { createHash, randomUUID } from "node:crypto";

import { calculateJwkThumbprint, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { DpopReplayStoreUnavailableException } from "../src/auth/bearer-auth.errors.js";
import {
  canonicalizeDpopHtu,
  DpopNonceRequiredError,
  DpopProofValidationError,
  JoseDpopProofVerifier,
} from "../src/auth/dpop-proof-verifier.js";
import { InMemoryDpopReplayStore, type DpopReplayStore } from "../src/auth/dpop-replay-store.js";
import type { VerifiedAccessToken } from "../src/auth/auth.types.js";
import type { ApiRuntimeConfig } from "../src/runtime-config.js";

const NOW = 2_000_000_000_000;
const TOKEN = `header.${"a".repeat(48)}.signature`;
const API_ORIGIN = "https://api.example.edu";
const PATH = "/v1/personal/vault?ignored=query";

type SigningKey = Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
type PublicJwk = Awaited<ReturnType<typeof exportJWK>>;

let privateKey: SigningKey;
let publicJwk: PublicJwk;
let jkt: string;

const config: ApiRuntimeConfig = {
  ai: {
    knowledgeBaseUrl: new URL("http://127.0.0.1:8100"),
    maxResponseBytes: 262_144,
    serviceHmacKey: new Uint8Array(32),
    rateLimit: {
      clientLimit: 12,
      globalLimit: 600,
      networkLimit: 120,
      redisUrl: new URL("redis://:test@127.0.0.1:6379"),
      windowSeconds: 60,
    },
    requestTimeoutMs: 3_000,
  },
  cors: { allowedOrigins: ["https://assistant.example.edu"] },
  nodeEnv: "test",
  oidc: {
    allowedClientIds: ["gopher-web"],
    audience: "gopher-api",
    dpop: {
      nonceTtlSeconds: 300,
      operationTimeoutMs: 1_000,
      proofLimit: 600,
      proofMaxAgeSeconds: 60,
      proofWindowSeconds: 60,
      publicOrigin: new URL(API_ORIGIN),
      redisUrl: new URL("rediss://:test@redis.example.edu"),
      replayTtlSeconds: 120,
    },
    issuer: "https://identity.example.edu/realms/gopher",
    jwksUrl: new URL("https://identity.example.edu/realms/gopher/certs"),
    maxTokenLifetimeSeconds: 300,
  },
  port: 4000,
};

function authorization(thumbprint = jkt): VerifiedAccessToken {
  return {
    clientId: "gopher-web",
    dpopJkt: thumbprint,
    issuer: config.oidc.issuer,
    scopes: ["personal:read"],
    subject: "student",
  };
}

interface ProofOverrides {
  readonly claims?: Readonly<Record<string, unknown>>;
  readonly header?: Readonly<Record<string, unknown>>;
  readonly jti?: string;
  readonly key?: SigningKey;
  readonly nonce?: string;
}

async function proof(overrides: ProofOverrides = {}): Promise<string> {
  return new SignJWT({
    ath: createHash("sha256").update(TOKEN, "ascii").digest("base64url"),
    htm: "GET",
    htu: `${API_ORIGIN}/v1/personal/vault`,
    iat: Math.floor(NOW / 1_000),
    jti: overrides.jti ?? randomUUID(),
    ...(overrides.nonce === undefined ? {} : { nonce: overrides.nonce }),
    ...overrides.claims,
  })
    .setProtectedHeader({
      alg: "ES256",
      jwk: publicJwk,
      typ: "dpop+jwt",
      ...overrides.header,
    })
    .sign(overrides.key ?? privateKey);
}

function input(encodedProof: string, auth = authorization()) {
  return {
    accessToken: TOKEN,
    authorization: auth,
    method: "GET",
    proof: encodedProof,
    rawUrl: PATH,
  } as const;
}

beforeAll(async () => {
  const pair = await generateKeyPair("ES256", { extractable: true });
  privateKey = pair.privateKey;
  publicJwk = await exportJWK(pair.publicKey);
  jkt = await calculateJwkThumbprint(publicJwk, "sha256");
});

describe("RFC 9449 proof verifier", () => {
  it("retains replay claims through the inclusive, second-rounded accepted proof window", () => {
    const replayStore = new InMemoryDpopReplayStore(300_000, 120_000, () => NOW);
    expect(
      () =>
        new JoseDpopProofVerifier(
          {
            ...config,
            oidc: {
              ...config.oidc,
              dpop: { ...config.oidc.dpop, replayTtlSeconds: 65 },
            },
          },
          replayStore,
          () => NOW,
        ),
    ).toThrow("complete accepted proof window");
    expect(
      () =>
        new JoseDpopProofVerifier(
          {
            ...config,
            oidc: {
              ...config.oidc,
              dpop: { ...config.oidc.dpop, replayTtlSeconds: 66 },
            },
          },
          replayStore,
          () => NOW,
        ),
    ).not.toThrow();
  });

  it("challenges once, accepts nonce reuse with new jti, and rejects the same proof across instances", async () => {
    const shared = new InMemoryDpopReplayStore(300_000, 120_000, () => NOW);
    const firstNode = new JoseDpopProofVerifier(config, shared, () => NOW);
    const secondNode = new JoseDpopProofVerifier(config, shared, () => NOW);
    let nonce = "";
    try {
      await firstNode.verify(input(await proof()));
    } catch (error) {
      expect(error).toBeInstanceOf(DpopNonceRequiredError);
      nonce = (error as DpopNonceRequiredError).nonce;
    }
    expect(nonce).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    const accepted = await proof({ nonce });
    await firstNode.verify(input(accepted));
    await secondNode.verify(input(await proof({ nonce })));
    await expect(secondNode.verify(input(accepted))).rejects.toBeInstanceOf(DpopProofValidationError);
  });

  it("expires a server nonce and challenges with a replacement", async () => {
    let now = NOW;
    const shared = new InMemoryDpopReplayStore(1_000, 120_000, () => now);
    const verifier = new JoseDpopProofVerifier(config, shared, () => now);
    let nonce = "";
    await verifier.verify(input(await proof())).catch((error: unknown) => {
      nonce = (error as DpopNonceRequiredError).nonce;
    });
    now += 1_001;
    const error = await verifier.verify(input(await proof({ nonce }))).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DpopNonceRequiredError);
    expect((error as DpopNonceRequiredError).nonce).not.toBe(nonce);
  });

  it("does not rotate nonce state when a stale proof is replayed repeatedly", async () => {
    const shared = new InMemoryDpopReplayStore(300_000, 120_000, () => NOW);
    const verifier = new JoseDpopProofVerifier(config, shared, () => NOW);
    let currentNonce = "";
    await verifier.verify(input(await proof())).catch((error: unknown) => {
      currentNonce = (error as DpopNonceRequiredError).nonce;
    });

    const stale = await proof({ jti: "stale-proof-jti-0001", nonce: "stale-nonce-value" });
    const firstChallenge = await verifier.verify(input(stale)).catch((error: unknown) => error);
    expect(firstChallenge).toBeInstanceOf(DpopNonceRequiredError);
    expect((firstChallenge as DpopNonceRequiredError).nonce).toBe(currentNonce);
    for (let replay = 0; replay < 3; replay += 1) {
      await expect(verifier.verify(input(stale))).rejects.toBeInstanceOf(DpopProofValidationError);
    }

    await expect(verifier.verify(input(await proof({ nonce: currentNonce })))).resolves.toBeUndefined();
  });

  it("accepts two concurrent fresh proofs carrying the same current nonce", async () => {
    const shared = new InMemoryDpopReplayStore(300_000, 120_000, () => NOW);
    const firstNode = new JoseDpopProofVerifier(config, shared, () => NOW);
    const secondNode = new JoseDpopProofVerifier(config, shared, () => NOW);
    let nonce = "";
    await firstNode.verify(input(await proof())).catch((error: unknown) => {
      nonce = (error as DpopNonceRequiredError).nonce;
    });
    const [firstProof, secondProof] = await Promise.all([
      proof({ jti: "concurrent-proof-jti-0001", nonce }),
      proof({ jti: "concurrent-proof-jti-0002", nonce }),
    ]);

    await expect(
      Promise.all([firstNode.verify(input(firstProof)), secondNode.verify(input(secondProof))]),
    ).resolves.toEqual([undefined, undefined]);
  });

  it("accepts bounded short and Unicode JWT IDs required by RFC 7519 interoperability", async () => {
    const shared = new InMemoryDpopReplayStore(300_000, 120_000, () => NOW);
    const verifier = new JoseDpopProofVerifier(config, shared, () => NOW);
    let nonce = "";
    await verifier.verify(input(await proof({ jti: "短" }))).catch((error: unknown) => {
      nonce = (error as DpopNonceRequiredError).nonce;
    });

    await expect(verifier.verify(input(await proof({ jti: "😀", nonce })))).resolves.toBeUndefined();
  });

  it("accepts safe protected-header, public-JWK, and claim extensions", async () => {
    const shared = new InMemoryDpopReplayStore(300_000, 120_000, () => NOW);
    const verifier = new JoseDpopProofVerifier(config, shared, () => NOW);
    let nonce = "";
    await verifier.verify(input(await proof())).catch((error: unknown) => {
      nonce = (error as DpopNonceRequiredError).nonce;
    });
    await expect(
      verifier.verify(
        input(
          await proof({
            claims: { "urn:example:proof-context": "test" },
            header: {
              jwk: { ...publicJwk, use: "sig", "urn:example:key-context": "test" },
              kid: "issuer-local-key-label",
              "urn:example:header-context": "test",
            },
            nonce,
          }),
        ),
      ),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["wrong typ", { header: { typ: "JWT" } }],
    ["private key in protected jwk", { header: { jwk: { ...publicJwk, d: "a".repeat(43) } } }],
    ["missing ath", { claims: { ath: undefined } }],
    ["lowercase method", { claims: { htm: "get" } }],
    ["non-HTTP htu", { claims: { htu: "ftp://api.example.edu/v1/personal/vault" } }],
    ["future iat", { claims: { iat: Math.floor(NOW / 1_000) + 6 } }],
    ["expired iat", { claims: { iat: Math.floor(NOW / 1_000) - 61 } }],
  ] as const)("rejects %s", async (_label, overrides) => {
    const verifier = new JoseDpopProofVerifier(
      config,
      new InMemoryDpopReplayStore(300_000, 120_000, () => NOW),
      () => NOW,
    );
    await expect(verifier.verify(input(await proof(overrides)))).rejects.toBeInstanceOf(
      DpopProofValidationError,
    );
  });

  it.each([
    ["HTTPS://EXAMPLE.COM:443", "https://example.com/"],
    ["https://example.com/%7euser/%41/%2f/%ab?ignored=query#ignored", "https://example.com/~user/A/%2F/%AB"],
    ["https://example.com/a/./b/../c", "https://example.com/a/c"],
    ["https://bücher.example:443", "https://xn--bcher-kva.example/"],
    ["http://EXAMPLE.com:80", "http://example.com/"],
  ])("normalizes RFC 3986 htu %s", (value, expected) => {
    expect(canonicalizeDpopHtu(value)).toBe(expected);
  });

  it("rejects malformed percent encoding in htu", () => {
    expect(() => canonicalizeDpopHtu("https://example.com/%zz")).toThrow(DpopProofValidationError);
  });

  it("binds the embedded public key thumbprint to cnf.jkt", async () => {
    const verifier = new JoseDpopProofVerifier(
      config,
      new InMemoryDpopReplayStore(300_000, 120_000, () => NOW),
      () => NOW,
    );
    await expect(
      verifier.verify(input(await proof(), authorization(Buffer.alloc(32, 9).toString("base64url")))),
    ).rejects.toBeInstanceOf(DpopProofValidationError);
  });

  it("accepts the complete RFC 9449 NQCHAR nonce syntax, including one character", async () => {
    const store: DpopReplayStore = {
      consume: (_subject, _jkt, _jti, nonce) =>
        Promise.resolve(nonce === "!" ? { status: "accepted" } : { nonce: "!", status: "challenge" }),
    };
    const verifier = new JoseDpopProofVerifier(config, store, () => NOW);

    await expect(verifier.verify(input(await proof({ nonce: "!" })))).resolves.toBeUndefined();
  });

  it("propagates replay-store failure so the HTTP boundary can return 503", async () => {
    const unavailable: DpopReplayStore = {
      consume: () => Promise.reject(new DpopReplayStoreUnavailableException()),
    };
    const verifier = new JoseDpopProofVerifier(config, unavailable, () => NOW);
    await expect(verifier.verify(input(await proof({ nonce: "valid-test-nonce" })))).rejects.toBeInstanceOf(
      DpopReplayStoreUnavailableException,
    );
  });
});
