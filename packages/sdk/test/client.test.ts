import { createServer } from "node:http";
import { gzipSync } from "node:zlib";

import { decodeJwt } from "jose";
import { describe, expect, it, vi } from "vitest";

import {
  ABSOLUTE_MAX_RESPONSE_BODY_BYTES,
  DEFAULT_MAX_ERROR_RESPONSE_BODY_BYTES,
  DEFAULT_MAX_SUCCESS_RESPONSE_BODY_BYTES,
  GopherApiError,
  GopherClient,
  GopherProtocolError,
  dpopThumbprint,
  generateDpopPrivateJwk,
} from "../src/index.js";
import { TEST_DPOP_CREDENTIAL, testAccessToken } from "./dpop-fixture.js";

const baseUrl = "https://assistant.example.test/base/";

function response(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    headers,
    status: init.status ?? 200,
  });
}

const textEncoder = new TextEncoder();

function streamedJsonResponse(
  body: unknown,
  init: ResponseInit & { readonly chunkSize?: number } = {},
  onCancel?: () => void,
): Response {
  const bytes = textEncoder.encode(JSON.stringify(body));
  const chunkSize = init.chunkSize ?? bytes.byteLength;
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      onCancel?.();
    },
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.byteLength);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
  });
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return new Response(stream, { headers, status: init.status ?? 200 });
}

function reusedOneByteChunkResponse(body: unknown): {
  readonly response: Response;
  readonly uniqueChunkViews: number;
} {
  const bytes = textEncoder.encode(JSON.stringify(body));
  const reusableChunk = new Uint8Array(1);
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (offset >= bytes.byteLength) {
          controller.close();
          return;
        }
        reusableChunk[0] = bytes[offset] ?? 0;
        controller.enqueue(reusableChunk);
        offset += 1;
      },
    },
    { highWaterMark: 0 },
  );
  return {
    response: new Response(stream, { headers: { "content-type": "application/json" } }),
    uniqueChunkViews: 1,
  };
}

const validHealth = {
  service: "campus-api",
  status: "ok",
  time: "2026-07-19T12:00:00.000Z",
  version: "0.1.0",
} as const;

const validCampus = {
  academicCalendarCampusId: "tc",
  academicInstitutionCode: "UMNTC",
  city: { en: "Minneapolis", "zh-CN": "明尼阿波利斯" },
  id: "tc",
  name: { en: "Twin Cities", "zh-CN": "双城校区" },
  officialStatus: "UNVERIFIED",
  sourceUrl: "https://twin-cities.umn.edu/",
  timeZone: "America/Chicago",
} as const;

const validSource = {
  attribution: "University public page",
  authorizationEvidenceUrl: null,
  cacheDisposition: {
    derivedArtifacts: "PROHIBITED",
    normalizedRecords: "NEVER_STORE",
    rawResponse: "NEVER_STORE",
    retentionSeconds: null,
  },
  cachePolicy: "NO_CONTENT_CACHE",
  campusIds: ["tc"],
  dataClasses: ["PUBLIC_METADATA"],
  dataClassification: "PUBLIC",
  freshnessState: "FRESH",
  id: "tc-campus-home",
  killSwitch: {
    defaultState: "ENABLED",
    fallback: "UNAVAILABLE",
    key: "source.tc-campus-home.enabled",
  },
  lastCheckedAt: "2026-07-19T12:00:00-05:00",
  licenseEvidenceUrl: null,
  licenseStatus: "DEEPLINK_ONLY",
  name: { en: "Campus home", "zh-CN": "校区主页" },
  officialStatus: "PUBLISHER_ASSERTED",
  owner: {
    contactUrl: "https://github.com/appleweiping/umn-gopher-assistant/security/policy",
    teamId: "catalog-integrations",
  },
  publisher: "University of Minnesota",
  resourceKinds: ["CAMPUS_DEEPLINK"],
  sourceUrl: "https://twin-cities.umn.edu/",
  termsReviewExpiresAt: null,
  termsReviewedAt: null,
  verificationState: "schematic",
} as const;

const validSourceObservation = {
  appliedCacheDisposition: "DISCARDED_AFTER_RESPONSE",
  cachePolicy: "NO_CONTENT_CACHE",
  campusId: "tc",
  dataClassification: "PUBLIC",
  durationMs: 12,
  failureCode: null,
  freshnessState: "FRESH",
  httpStatus: 200,
  licenseStatus: "LIVE_ONLY",
  observationId: "210f27aa-203d-4a87-a93a-a23b89044b2a",
  observedAt: "2026-07-22T12:00:00.000Z",
  outcome: "SUCCESS",
  parserVersion: "livewhale-events@1",
  rawByteLength: 512,
  rawSha256: "a".repeat(64),
  recordsAccepted: 0,
  recordsRejected: 0,
  sourceId: "tc-events-feed",
} as const;

const validEventPage = {
  items: [],
  nextCursor: null,
  range: { defaulted: false, from: "2026-09-01", to: "2026-09-30" },
  retrievalCoverage: {
    nextUpstreamPage: null,
    pagesFetched: 1,
    recordsFetched: 0,
    sourceTotalPages: 0,
    sourceTotalRecords: 0,
    truncatedByPolicy: false,
  },
  sourceObservations: [validSourceObservation],
} as const;

const validManifest = {
  campusId: "tc",
  etag: '"tc-world-v1"',
  generatedAt: "2026-07-19T12:00:00Z",
  portals: [],
  revision: 1,
  sourceIds: ["tc-campus-home"],
  tiles: [],
  verificationState: "schematic",
  worldVersion: "tc-schematic-v1",
} as const;

const vaultIds = {
  authorizationKey: "018fb9d8-3ec5-7e8b-a512-35f8ff523114",
  device: "018fb9d8-3ec5-7e8b-a512-35f8ff523112",
  encryptionKey: "018fb9d8-3ec5-7e8b-a512-35f8ff523113",
  operation: "018fb9d8-3ec5-7e8b-a512-35f8ff523116",
  recoveryKey: "018fb9d8-3ec5-7e8b-a512-35f8ff523115",
  vault: "018fb9d8-3ec5-7e8b-a512-35f8ff523110",
  vaultKey: "018fb9d8-3ec5-7e8b-a512-35f8ff523111",
} as const;
const vaultOwnerBinding = "A".repeat(43);
const vaultHash = "A".repeat(43);
const vaultSignature = "A".repeat(86);
const vaultCreatedAt = "2026-07-23T00:00:00.000Z";
const validVaultDevice = {
  authorizationKey: {
    algorithm: "ED25519",
    fingerprint: vaultHash,
    keyId: vaultIds.authorizationKey,
    publicKey: vaultHash,
  },
  createdAt: vaultCreatedAt,
  deviceId: vaultIds.device,
  encryptionKey: {
    algorithm: "X25519",
    fingerprint: vaultHash,
    keyId: vaultIds.encryptionKey,
    publicKey: vaultHash,
  },
  formatVersion: 2,
  ownerBinding: vaultOwnerBinding,
  revokedAt: null,
} as const;
const validVaultSnapshot = {
  authorizationManifest: {
    createdAt: vaultCreatedAt,
    devices: [validVaultDevice],
    epoch: 1,
    formatVersion: 2,
    ownerBinding: vaultOwnerBinding,
    recoveryAuthorization: {
      algorithm: "ED25519",
      createdAt: vaultCreatedAt,
      fingerprint: vaultHash,
      formatVersion: 2,
      keyId: vaultIds.recoveryKey,
      ownerBinding: vaultOwnerBinding,
      publicKey: vaultHash,
      revokedAt: null,
      vaultId: vaultIds.vault,
    },
    revision: 1,
    updatedAt: vaultCreatedAt,
    vaultId: vaultIds.vault,
  },
  commit: {
    author: {
      deviceId: vaultIds.device,
      keyId: vaultIds.authorizationKey,
      kind: "DEVICE",
    },
    authorizationManifestHash: vaultHash,
    createdAt: vaultCreatedAt,
    epoch: 1,
    formatVersion: 2,
    keyringHash: vaultHash,
    operationId: vaultIds.operation,
    ownerBinding: vaultOwnerBinding,
    parentCommitHash: null,
    payloadHash: vaultHash,
    sequence: 1,
    signature: vaultSignature,
    stateMac: vaultHash,
    vaultId: vaultIds.vault,
  },
  commitHash: vaultHash,
  formatVersion: 2,
  keyring: {
    createdAt: vaultCreatedAt,
    deviceEnvelopes: [
      {
        cipherSuite: "X25519_XCHACHA20_POLY1305",
        createdAt: vaultCreatedAt,
        ephemeralPublicKey: vaultHash,
        formatVersion: 1,
        nonce: "A".repeat(32),
        recipientDeviceId: vaultIds.device,
        recipientKeyId: vaultIds.encryptionKey,
        recipientPublicKeyFingerprint: vaultHash,
        vaultId: vaultIds.vault,
        vaultKeyId: vaultIds.vaultKey,
        wrappedKey: "A".repeat(107),
      },
    ],
    formatVersion: 1,
    recoveryEnvelope: {
      aad: "AA",
      cipherSuite: "XCHACHA20_POLY1305",
      createdAt: vaultCreatedAt,
      formatVersion: 1,
      kdf: {
        algorithm: "ARGON2ID13",
        memLimitBytes: 67_108_864,
        opsLimit: 2,
        outputBytes: 32,
        salt: "A".repeat(22),
      },
      nonce: "A".repeat(32),
      vaultId: vaultIds.vault,
      vaultKeyId: vaultIds.vaultKey,
      wrappedKey: "A".repeat(64),
    },
    revision: 1,
    updatedAt: vaultCreatedAt,
    vaultId: vaultIds.vault,
    vaultKeyId: vaultIds.vaultKey,
  },
  ownerBinding: vaultOwnerBinding,
  payload: {
    aad: "AA",
    baseRevision: null,
    cipherSuite: "XCHACHA20_POLY1305",
    ciphertext: "A".repeat(5483),
    contentSchemaVersion: 1,
    contentType: "application/vnd.umn-gopher-assistant.personal-vault+json",
    createdAt: vaultCreatedAt,
    formatVersion: 2,
    nonce: "A".repeat(32),
    ownerBinding: vaultOwnerBinding,
    padding: { algorithm: "SODIUM_PAD", blockSize: 4096 },
    revision: 1,
    vaultId: vaultIds.vault,
    vaultKeyId: vaultIds.vaultKey,
  },
  vaultId: vaultIds.vault,
} as const;
const validCreateVaultCommand = {
  commandType: "CREATE_VAULT",
  formatVersion: 2,
  operationId: vaultIds.operation,
  ownerBinding: vaultOwnerBinding,
  proof: {
    commandType: "CREATE_VAULT",
    expectedParentCommitHash: null,
    expiresAt: "2026-07-23T00:05:00.000Z",
    formatVersion: 2,
    issuedAt: vaultCreatedAt,
    nextCommitHash: vaultHash,
    operationId: vaultIds.operation,
    ownerBinding: vaultOwnerBinding,
    signature: vaultSignature,
    signer: {
      deviceId: vaultIds.device,
      keyId: vaultIds.authorizationKey,
      kind: "DEVICE",
    },
    vaultId: vaultIds.vault,
  },
  snapshot: validVaultSnapshot,
  vaultId: vaultIds.vault,
} as const;

describe("GopherClient", () => {
  it("requires HTTPS except for explicit loopback development hosts", () => {
    expect(() => new GopherClient({ baseUrl: "http://api.example.test" })).toThrow(/must use HTTPS/u);
    expect(() => new GopherClient({ baseUrl: "http://127.0.0.1:3000" })).not.toThrow();
    expect(() => new GopherClient({ baseUrl: "http://[::1]:3000" })).not.toThrow();
  });

  it("requires finite positive integer response limits at or below the absolute cap", () => {
    for (const maxSuccessResponseBodyBytes of [
      0,
      -1,
      1.5,
      Number.POSITIVE_INFINITY,
      ABSOLUTE_MAX_RESPONSE_BODY_BYTES + 1,
    ]) {
      expect(() => new GopherClient({ baseUrl, maxSuccessResponseBodyBytes })).toThrow(RangeError);
    }
    for (const maxErrorResponseBodyBytes of [0, -1, 1.5, Number.NaN, ABSOLUTE_MAX_RESPONSE_BODY_BYTES + 1]) {
      expect(() => new GopherClient({ baseUrl, maxErrorResponseBodyBytes })).toThrow(RangeError);
    }
    expect(
      () =>
        new GopherClient({
          baseUrl,
          maxErrorResponseBodyBytes: ABSOLUTE_MAX_RESPONSE_BODY_BYTES,
          maxSuccessResponseBodyBytes: ABSOLUTE_MAX_RESPONSE_BODY_BYTES,
        }),
    ).not.toThrow();
  });

  it("enforces safe default limits for both successful and RFC 9457 responses", async () => {
    const successCancelled = vi.fn();
    const errorCancelled = vi.fn();
    const problem = {
      detail: "Too large",
      instance: "/v1/events",
      status: 400,
      title: "Bad Request",
      traceId: "trace-default-limit",
      type: "about:blank",
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        streamedJsonResponse(
          validHealth,
          { headers: { "content-length": String(DEFAULT_MAX_SUCCESS_RESPONSE_BODY_BYTES + 1) } },
          successCancelled,
        ),
      )
      .mockResolvedValueOnce(
        streamedJsonResponse(
          problem,
          {
            headers: {
              "content-length": String(DEFAULT_MAX_ERROR_RESPONSE_BODY_BYTES + 1),
              "content-type": "application/problem+json",
            },
            status: 400,
          },
          errorCancelled,
        ),
      );
    const client = new GopherClient({
      baseUrl,
      dpopCredential: TEST_DPOP_CREDENTIAL,
      fetch: fetchMock,
    });

    await expect(client.request("getHealth")).rejects.toMatchObject({
      code: "response-body-too-large",
      status: 200,
    });
    await expect(client.request("listEvents")).rejects.toMatchObject({
      code: "response-body-too-large",
      status: 400,
    });
    expect(successCancelled).toHaveBeenCalledOnce();
    expect(errorCancelled).toHaveBeenCalledOnce();
  });

  it("rejects an oversized declared success body before consuming it and cancels the stream", async () => {
    const cancelled = vi.fn();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        streamedJsonResponse(
          validHealth,
          { headers: { "content-encoding": "identity", "content-length": "65" } },
          cancelled,
        ),
      );
    const client = new GopherClient({
      baseUrl,
      fetch: fetchMock,
      maxSuccessResponseBodyBytes: 64,
    });

    const error = await client.request("getHealth").catch((value: unknown) => value);

    expect(error).toBeInstanceOf(GopherProtocolError);
    expect(error).toMatchObject({
      code: "response-body-too-large",
      operationId: "getHealth",
      status: 200,
    });
    expect(cancelled).toHaveBeenCalledOnce();
    expect(JSON.stringify(error)).not.toContain(JSON.stringify(validHealth));
  });

  it.each(["gzip", "br", "deflate", "identity, gzip"])(
    "ignores encoded Content-Length for an already decoded %s response",
    async (contentEncoding) => {
      const decodedByteLength = textEncoder.encode(JSON.stringify(validHealth)).byteLength;
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        streamedJsonResponse(validHealth, {
          headers: {
            "content-encoding": contentEncoding,
            "content-length": String(decodedByteLength + 10),
          },
        }),
      );
      const client = new GopherClient({
        baseUrl,
        fetch: fetchMock,
        maxSuccessResponseBodyBytes: decodedByteLength,
      });

      await expect(client.request("getHealth")).resolves.toMatchObject({ data: validHealth });
    },
  );

  it("still rejects an oversized decoded body when its encoded length is small", async () => {
    const largeHealth = { ...validHealth, version: "x".repeat(256) };
    const cancelled = vi.fn();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      streamedJsonResponse(
        largeHealth,
        {
          chunkSize: 5,
          headers: { "content-encoding": "gzip", "content-length": "1" },
        },
        cancelled,
      ),
    );
    const client = new GopherClient({
      baseUrl,
      fetch: fetchMock,
      maxSuccessResponseBodyBytes: 64,
    });

    await expect(client.request("getHealth")).rejects.toMatchObject({
      code: "response-body-too-large",
      status: 200,
    });
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("handles a genuinely gzip-compressed fetch response by limiting the decoded stream", async () => {
    const decoded = JSON.stringify(validHealth);
    const compressed = gzipSync(decoded);
    const decodedByteLength = Buffer.byteLength(decoded);
    expect(compressed.byteLength).toBeGreaterThan(decodedByteLength);

    const server = createServer((_request, serverResponse) => {
      serverResponse.writeHead(200, {
        "content-encoding": "gzip",
        "content-length": String(compressed.byteLength),
        "content-type": "application/json",
      });
      serverResponse.end(compressed);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Expected a TCP test server");

    try {
      const client = new GopherClient({
        baseUrl: `http://127.0.0.1:${address.port}`,
        maxSuccessResponseBodyBytes: decodedByteLength,
      });
      await expect(client.request("getHealth")).resolves.toMatchObject({ data: validHealth });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it("counts every chunk when Content-Length is absent or understates the body", async () => {
    const firstCancelled = vi.fn();
    const secondCancelled = vi.fn();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(streamedJsonResponse(validHealth, { chunkSize: 7 }, firstCancelled))
      .mockResolvedValueOnce(
        streamedJsonResponse(
          validHealth,
          { chunkSize: 5, headers: { "content-length": "1" } },
          secondCancelled,
        ),
      );
    const client = new GopherClient({
      baseUrl,
      fetch: fetchMock,
      maxSuccessResponseBodyBytes: 32,
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(client.request("getHealth")).rejects.toMatchObject({
        code: "response-body-too-large",
        operationId: "getHealth",
      });
    }
    expect(firstCancelled).toHaveBeenCalledOnce();
    expect(secondCancelled).toHaveBeenCalledOnce();
  });

  it("copies many reused one-byte chunks directly into bounded contiguous storage", async () => {
    const largeHealth = { ...validHealth, version: "x".repeat(100_000) };
    const streamed = reusedOneByteChunkResponse(largeHealth);
    const byteLength = textEncoder.encode(JSON.stringify(largeHealth)).byteLength;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(streamed.response);
    const client = new GopherClient({
      baseUrl,
      fetch: fetchMock,
      maxSuccessResponseBodyBytes: byteLength,
    });

    expect(streamed.uniqueChunkViews).toBe(1);
    await expect(client.request("getHealth")).resolves.toMatchObject({ data: largeHealth });
  });

  it("accepts a success body exactly at the configured byte boundary", async () => {
    const byteLength = textEncoder.encode(JSON.stringify(validHealth)).byteLength;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(streamedJsonResponse(validHealth, { chunkSize: 3 }));
    const client = new GopherClient({
      baseUrl,
      fetch: fetchMock,
      maxSuccessResponseBodyBytes: byteLength,
    });

    await expect(client.request("getHealth")).resolves.toMatchObject({ data: validHealth });
  });

  it("bounds RFC 9457 error bodies without retaining attacker-controlled content", async () => {
    const problem = {
      detail: "attacker-secret-detail",
      instance: "/v1/events",
      status: 400,
      title: "Bad Request",
      traceId: "trace-400",
      type: "https://assistant.example.test/problems/bad-request",
    };
    const byteLength = textEncoder.encode(JSON.stringify(problem)).byteLength;
    const cancelled = vi.fn();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        streamedJsonResponse(problem, {
          chunkSize: 11,
          headers: { "content-type": "application/problem+json" },
          status: 400,
        }),
      )
      .mockResolvedValueOnce(
        streamedJsonResponse(
          problem,
          {
            chunkSize: 2,
            headers: { "content-type": "application/problem+json" },
            status: 400,
          },
          cancelled,
        ),
      );
    const exactClient = new GopherClient({
      baseUrl,
      fetch: fetchMock,
      maxErrorResponseBodyBytes: byteLength,
    });

    await expect(exactClient.request("listEvents")).rejects.toMatchObject({
      name: "GopherApiError",
      problem: { detail: "attacker-secret-detail", status: 400 },
    });

    const boundedClient = new GopherClient({
      baseUrl,
      fetch: fetchMock,
      maxErrorResponseBodyBytes: 32,
    });
    const error = await boundedClient.request("listEvents").catch((value: unknown) => value);

    expect(error).toBeInstanceOf(GopherProtocolError);
    expect(error).toMatchObject({ code: "response-body-too-large", status: 400 });
    expect(String(error)).not.toContain("attacker-secret-detail");
    expect(JSON.stringify(error)).not.toContain("attacker-secret-detail");
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("does not compare encoded RFC 9457 Content-Length with the decoded error limit", async () => {
    const problem = {
      detail: "Encoded problem detail",
      instance: "/v1/events",
      status: 400,
      title: "Bad Request",
      traceId: "trace-encoded-error",
      type: "about:blank",
    };
    const byteLength = textEncoder.encode(JSON.stringify(problem)).byteLength;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      streamedJsonResponse(problem, {
        headers: {
          "content-encoding": "br",
          "content-length": String(byteLength + 100),
          "content-type": "application/problem+json",
        },
        status: 400,
      }),
    );
    const client = new GopherClient({
      baseUrl,
      fetch: fetchMock,
      maxErrorResponseBodyBytes: byteLength,
    });

    await expect(client.request("listEvents")).rejects.toMatchObject({
      name: "GopherApiError",
      problem: { detail: "Encoded problem detail", status: 400 },
    });
  });

  it("does not trust invalid or impossibly large Content-Length values", async () => {
    const actualByteLength = textEncoder.encode(JSON.stringify(validHealth)).byteLength;
    const hugeCancelled = vi.fn();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        streamedJsonResponse(validHealth, { headers: { "content-length": "not-a-number" } }),
      )
      .mockResolvedValueOnce(
        streamedJsonResponse(
          validHealth,
          { headers: { "content-length": "999999999999999999999999999999" } },
          hugeCancelled,
        ),
      );
    const client = new GopherClient({
      baseUrl,
      fetch: fetchMock,
      maxSuccessResponseBodyBytes: actualByteLength,
    });

    await expect(client.request("getHealth")).resolves.toMatchObject({ data: validHealth });
    await expect(client.request("getHealth")).rejects.toMatchObject({
      code: "response-body-too-large",
      status: 200,
    });
    expect(hugeCancelled).toHaveBeenCalledOnce();
  });

  it("measures multibyte UTF-8 responses in bytes rather than JavaScript characters", async () => {
    const body = [validCampus];
    const json = JSON.stringify(body);
    const byteLength = textEncoder.encode(json).byteLength;
    expect(byteLength).toBeGreaterThan(json.length);

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(streamedJsonResponse(body, { chunkSize: 4 }))
      .mockResolvedValueOnce(streamedJsonResponse(body, { chunkSize: 4 }));
    const characterLimitedClient = new GopherClient({
      baseUrl,
      fetch: fetchMock,
      maxSuccessResponseBodyBytes: json.length,
    });
    await expect(characterLimitedClient.request("listCampuses")).rejects.toMatchObject({
      code: "response-body-too-large",
    });

    const byteLimitedClient = new GopherClient({
      baseUrl,
      fetch: fetchMock,
      maxSuccessResponseBodyBytes: byteLength,
    });
    await expect(byteLimitedClient.request("listCampuses")).resolves.toMatchObject({ data: body });
  });

  it("calls a generated operation with typed query values", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(validEventPage, { headers: { etag: '"events-v1"' } }));
    const client = new GopherClient({
      baseUrl,
      dpopCredential: TEST_DPOP_CREDENTIAL,
      fetch: fetchMock,
    });

    const result = await client.request("listEvents", {
      query: { campusId: "tc", cursor: "next page", limit: 25 },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.url).toBe(
      "https://assistant.example.test/base/v1/events?campusId=tc&cursor=next+page&limit=25",
    );
    expect(request.method).toBe("GET");
    expect(result).toMatchObject({ notModified: false, status: 200, etag: '"events-v1"' });
  });

  it("encodes path parameters without allowing them to reshape the URL", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(validManifest));
    const client = new GopherClient({
      baseUrl,
      dpopCredential: TEST_DPOP_CREDENTIAL,
      fetch: fetchMock,
    });

    await client.request("getWorldManifest", {
      path: { campusId: "tc/../morris" as "tc" },
    });

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.url).toBe("https://assistant.example.test/base/v1/worlds/tc%2F..%2Fmorris/manifest");
  });

  it("resolves a token for each request without exposing it", async () => {
    const tokenProvider = vi.fn().mockResolvedValue(TEST_DPOP_CREDENTIAL);
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => response([]));
    const client = new GopherClient({ baseUrl, dpopCredential: tokenProvider, fetch: fetchMock });

    await client.request("listAcademicCourses", { query: { campusId: "rochester" } });

    expect(tokenProvider).toHaveBeenCalledOnce();
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.headers.get("authorization")).toBe(`DPoP ${TEST_DPOP_CREDENTIAL.accessToken}`);
    expect(request.headers.get("dpop")).toMatch(/^[^.]+\.[^.]+\.[^.]+$/u);
    expect(JSON.stringify(await client.request("listAcademicCourses"))).not.toContain(
      TEST_DPOP_CREDENTIAL.accessToken,
    );
  });

  it("does not resolve or attach a token for an explicitly public operation", async () => {
    const tokenProvider = vi.fn().mockResolvedValue(TEST_DPOP_CREDENTIAL);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(validHealth));
    const client = new GopherClient({ baseUrl, dpopCredential: tokenProvider, fetch: fetchMock });

    await client.request("getHealth");

    expect(tokenProvider).not.toHaveBeenCalled();
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.headers.has("authorization")).toBe(false);
  });

  it("fails closed before network access when a protected operation has no DPoP key", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new GopherClient({ baseUrl, fetch: fetchMock });
    await expect(client.request("listAcademicCourses")).rejects.toThrow(/requires a DPoP-bound credential/u);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries a nonce challenge without head-of-line blocking or stale nonce overwrite", async () => {
    const proofs: string[] = [];
    let call = 0;
    let inFlight = 0;
    let maximumInFlight = 0;
    let resolveOlderRequest!: () => void;
    let markOlderStarted!: () => void;
    const olderRequestCanFinish = new Promise<void>((resolve) => {
      resolveOlderRequest = resolve;
    });
    const olderRequestStarted = new Promise<void>((resolve) => {
      markOlderStarted = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>(async (request) => {
      const currentCall = (call += 1);
      proofs.push((request as Request).headers.get("dpop") ?? "");
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      if (currentCall === 3) {
        markOlderStarted();
        await olderRequestCanFinish;
      } else if (currentCall === 4) {
        await olderRequestStarted;
      }
      if (currentCall === 1) {
        inFlight -= 1;
        return response(
          {
            detail: "Use the server nonce.",
            instance: "/v1/academics/courses",
            status: 401,
            title: "Unauthorized",
            traceId: "nonce-challenge",
            type: "about:blank",
          },
          {
            headers: {
              "dpop-nonce": "resource-nonce-001",
              "www-authenticate": 'Bearer realm="legacy", dPoP realm="api", error="use_dpop_nonce", ext="ok"',
            },
            status: 401,
          },
        );
      }
      inFlight -= 1;
      return response([], {
        headers: { "dpop-nonce": `resource-nonce-${String(currentCall).padStart(3, "0")}` },
      });
    });
    const client = new GopherClient({
      baseUrl,
      dpopCredential: TEST_DPOP_CREDENTIAL,
      fetch: fetchMock,
    });

    await client.request("listAcademicCourses");
    const older = client.request("listAcademicCourses", { query: { campusId: "tc" } });
    await olderRequestStarted;
    await client.request("listAcademicCourses", { query: { campusId: "morris" } });
    resolveOlderRequest();
    await older;
    await client.request("listAcademicCourses", { query: { campusId: "duluth" } });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(maximumInFlight).toBe(2);
    const payloads = proofs.map((proof) => decodeJwt(proof));
    expect(payloads[0]?.["nonce"]).toBeUndefined();
    expect(payloads[1]?.["nonce"]).toBe("resource-nonce-001");
    expect(payloads[2]?.["nonce"]).toBe("resource-nonce-002");
    expect(payloads[3]?.["nonce"]).toBe("resource-nonce-002");
    expect(payloads[4]?.["nonce"]).toBe("resource-nonce-004");
    expect(new Set(payloads.map((payload) => payload.jti)).size).toBe(5);
  });

  it("expires resource nonces at the configured TTL", async () => {
    let nowMilliseconds = 2_100_000_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => nowMilliseconds);
    const proofs: string[] = [];
    let call = 0;
    const fetchMock = vi.fn<typeof fetch>(async (request) => {
      call += 1;
      proofs.push((request as Request).headers.get("dpop") ?? "");
      return response([], {
        headers: call === 1 ? { "dpop-nonce": "ttl-resource-nonce" } : {},
      });
    });
    const client = new GopherClient({
      baseUrl,
      dpopCredential: TEST_DPOP_CREDENTIAL,
      dpopNonceTtlMilliseconds: 1_000,
      fetch: fetchMock,
    });

    try {
      await client.request("listAcademicCourses");
      nowMilliseconds += 999;
      await client.request("listAcademicCourses");
      nowMilliseconds += 2;
      await client.request("listAcademicCourses");
    } finally {
      clock.mockRestore();
    }

    expect(proofs.map((proof) => decodeJwt(proof)["nonce"])).toEqual([
      undefined,
      "ttl-resource-nonce",
      undefined,
    ]);
  });

  it("evicts the least-recently-used nonce key at the configured capacity", async () => {
    const secondPrivateJwk = await generateDpopPrivateJwk();
    const secondCredential = {
      accessToken: testAccessToken(await dpopThumbprint(secondPrivateJwk)),
      privateJwk: secondPrivateJwk,
    };
    const credentials = [TEST_DPOP_CREDENTIAL, secondCredential, TEST_DPOP_CREDENTIAL];
    const proofs: string[] = [];
    let call = 0;
    const fetchMock = vi.fn<typeof fetch>(async (request) => {
      call += 1;
      proofs.push((request as Request).headers.get("dpop") ?? "");
      return response([], {
        headers: { "dpop-nonce": `capacity-nonce-${String(call)}` },
      });
    });
    const client = new GopherClient({
      baseUrl,
      dpopCredential: () => credentials.shift(),
      dpopNonceCacheMaxEntries: 1,
      fetch: fetchMock,
    });

    await client.request("listAcademicCourses");
    await client.request("listAcademicCourses");
    await client.request("listAcademicCourses");

    expect(proofs.map((proof) => decodeJwt(proof)["nonce"])).toEqual([undefined, undefined, undefined]);
  });

  it("sends idempotency and request correlation headers only where declared", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ routeId: "route-1" }));
    const client = new GopherClient({ baseUrl, fetch: fetchMock });

    await client.request("calculateRoute", {
      body: {
        campusId: "tc",
        destination: [-93.23, 44.98],
        origin: [-93.24, 44.97],
        profile: "walking",
      },
      idempotencyKey: "26cf2094-bfdf-4e98-aef5-03c51574bf37",
      requestId: "request-123",
    });

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.headers.has("if-none-match")).toBe(false);
    expect(request.headers.get("idempotency-key")).toBe("26cf2094-bfdf-4e98-aef5-03c51574bf37");
    expect(request.headers.get("x-request-id")).toBe("request-123");
    expect(request.headers.get("content-type")).toBe("application/json");
    await expect(request.clone().json()).resolves.toEqual({
      campusId: "tc",
      destination: [-93.23, 44.98],
      origin: [-93.24, 44.97],
      profile: "walking",
    });
  });

  it("enforces account-bound vault creation preconditions and operation-bound idempotency", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(validVaultSnapshot, { status: 201 }));
    const client = new GopherClient({
      baseUrl,
      dpopCredential: TEST_DPOP_CREDENTIAL,
      fetch: fetchMock,
    });

    await expect(
      client.request("createPersonalVault", {
        body: validCreateVaultCommand,
        idempotencyKey: "018fb9d8-3ec5-7e8b-a512-35f8ff523999",
      }),
    ).rejects.toThrow(/must equal body operationId/u);
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(
      client.request("createPersonalVault", {
        body: validCreateVaultCommand,
        idempotencyKey: vaultIds.operation,
      }),
    ).resolves.toMatchObject({ data: validVaultSnapshot, status: 201 });

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.headers.get("authorization")).toBe(`DPoP ${TEST_DPOP_CREDENTIAL.accessToken}`);
    expect(request.headers.get("if-none-match")).toBe("*");
    expect(request.headers.get("idempotency-key")).toBe(vaultIds.operation);
    expect(request.headers.has("if-match")).toBe(false);
  });

  it("surfaces a failed If-None-Match vault creation as the declared 412 problem", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      response(
        {
          detail: "A personal vault already exists.",
          instance: "/v1/personal/vault",
          status: 412,
          title: "Precondition Failed",
          traceId: "trace-vault-exists",
          type: "https://api.gopher-assistant.example/problems/precondition-failed",
        },
        { headers: { "content-type": "application/problem+json" }, status: 412 },
      ),
    );
    const client = new GopherClient({
      baseUrl,
      dpopCredential: TEST_DPOP_CREDENTIAL,
      fetch: fetchMock,
    });

    await expect(
      client.request("createPersonalVault", {
        body: validCreateVaultCommand,
        idempotencyKey: vaultIds.operation,
      }),
    ).rejects.toMatchObject({
      problem: { status: 412, title: "Precondition Failed" },
      status: 412,
    });
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.headers.get("if-none-match")).toBe("*");
  });

  it("requires a bounded possession proof and a strong validator for encrypted vault reads", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(undefined, { headers: { etag: '"vault-v1"' }, status: 304 }));
    const client = new GopherClient({
      baseUrl,
      dpopCredential: TEST_DPOP_CREDENTIAL,
      fetch: fetchMock,
    });
    const unsafeClient = client as unknown as {
      request(operationId: string, options?: Record<string, unknown>): Promise<unknown>;
    };

    await expect(unsafeClient.request("readPersonalVault", { etag: '"vault-v1"' })).rejects.toThrow(
      /requires vaultReadProof/u,
    );
    await expect(
      client.request("readPersonalVault", {
        etag: 'W/"vault-v1"',
        vaultReadProof: "A".repeat(64),
      }),
    ).rejects.toThrow(/exactly one strong ETag/u);
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(
      client.request("readPersonalVault", {
        etag: '"vault-v1"',
        vaultReadProof: "A".repeat(64),
      }),
    ).resolves.toEqual({
      etag: '"vault-v1"',
      notModified: true,
      status: 304,
    });
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.headers.get("if-none-match")).toBe('"vault-v1"');
    expect(request.headers.get("x-vault-read-proof")).toBe("A".repeat(64));
  });

  it("requires one strong If-Match validator for pairing mutations", async () => {
    const pairing = {
      createdAt: vaultCreatedAt,
      expiresAt: "2026-07-23T00:15:00.000Z",
      id: "018fb9d8-3ec5-7e8b-a512-35f8ff523117",
      requestingDevice: validVaultDevice,
      state: "cancelled",
      updatedAt: vaultCreatedAt,
      vaultId: vaultIds.vault,
    } as const;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(pairing));
    const client = new GopherClient({
      baseUrl,
      dpopCredential: TEST_DPOP_CREDENTIAL,
      fetch: fetchMock,
    });

    await expect(
      client.request("cancelPersonalVaultDevicePairing", {
        idempotencyKey: "018fb9d8-3ec5-7e8b-a512-35f8ff523118",
        ifMatch: 'W/"vault-v1"',
        path: { pairingId: pairing.id },
      }),
    ).rejects.toThrow(/exactly one strong ETag/u);
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(
      client.request("cancelPersonalVaultDevicePairing", {
        idempotencyKey: "018fb9d8-3ec5-7e8b-a512-35f8ff523118",
        ifMatch: '"vault-v1"',
        path: { pairingId: pairing.id },
      }),
    ).resolves.toMatchObject({ data: pairing, status: 200 });
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.headers.get("if-match")).toBe('"vault-v1"');
    expect(request.headers.get("idempotency-key")).toBe("018fb9d8-3ec5-7e8b-a512-35f8ff523118");
  });

  it("uses the contract's 16 MiB vault response boundary without raising the global default", async () => {
    const largeSnapshot = {
      ...validVaultSnapshot,
      payload: {
        ...validVaultSnapshot.payload,
        ciphertext: "A".repeat(DEFAULT_MAX_SUCCESS_RESPONSE_BODY_BYTES + 1024),
      },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => streamedJsonResponse(largeSnapshot));
    const constrainedClient = new GopherClient({
      baseUrl,
      dpopCredential: TEST_DPOP_CREDENTIAL,
      fetch: fetchMock,
      maxSuccessResponseBodyBytes: DEFAULT_MAX_SUCCESS_RESPONSE_BODY_BYTES,
    });
    await expect(
      constrainedClient.request("readPersonalVault", {
        vaultReadProof: "A".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "response-body-too-large" });

    const client = new GopherClient({
      baseUrl,
      dpopCredential: TEST_DPOP_CREDENTIAL,
      fetch: fetchMock,
    });
    await expect(
      client.request("readPersonalVault", {
        vaultReadProof: "A".repeat(64),
      }),
    ).resolves.toMatchObject({ data: largeSnapshot, status: 200 });
  });

  it("returns an explicit result for a 304 response", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(undefined, { headers: { etag: '"campuses-v1"' }, status: 304 }))
      .mockResolvedValueOnce(
        new Response(undefined, {
          headers: { "cache-control": "no-store", etag: 'W/"live-events-v1"' },
          status: 304,
        }),
      );
    const client = new GopherClient({
      baseUrl,
      dpopCredential: TEST_DPOP_CREDENTIAL,
      fetch: fetchMock,
    });

    await expect(client.request("listCampuses", { etag: '"campuses-v1"' })).resolves.toEqual({
      etag: '"campuses-v1"',
      notModified: true,
      status: 304,
    });
    await expect(
      client.request("listEvents", {
        etag: 'W/"live-events-v1"',
        query: { campusId: "tc" },
      }),
    ).resolves.toEqual({
      etag: 'W/"live-events-v1"',
      notModified: true,
      status: 304,
    });
  });

  it("converts RFC 9457 failures to a typed, credential-safe error", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      response(
        {
          detail: "The cursor is invalid.",
          instance: "/v1/events",
          status: 400,
          title: "Bad Request",
          traceId: "trace-400",
          type: "https://assistant.example.test/problems/invalid-cursor",
        },
        {
          headers: {
            "content-type": "application/problem+json",
            "x-request-id": "request-400",
          },
          status: 400,
        },
      ),
    );
    const client = new GopherClient({
      baseUrl,
      dpopCredential: TEST_DPOP_CREDENTIAL,
      fetch: fetchMock,
    });

    const error = await client.request("listAcademicCourses").catch((value: unknown) => value);

    expect(error).toBeInstanceOf(GopherApiError);
    expect(error).toMatchObject({
      problem: { status: 400, traceId: "trace-400" },
      requestId: "request-400",
      status: 400,
    });
    expect(JSON.stringify(error)).not.toContain(TEST_DPOP_CREDENTIAL.accessToken);
    expect(String(error)).not.toContain(TEST_DPOP_CREDENTIAL.accessToken);
  });

  it("uses the HTTP status when a problem body or media type is contradictory", async () => {
    const contradictoryProblem = {
      detail: "Untrusted contradictory detail.",
      instance: "/v1/academics/courses",
      status: 200,
      title: "Everything is fine",
      traceId: "untrusted-trace",
      type: "https://attacker.invalid/not-a-problem",
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(contradictoryProblem, {
          headers: { "content-type": "application/problem+json" },
          status: 401,
        }),
      )
      .mockResolvedValueOnce(response({ ...contradictoryProblem, status: 403 }, { status: 403 }));
    const client = new GopherClient({
      baseUrl,
      dpopCredential: TEST_DPOP_CREDENTIAL,
      fetch: fetchMock,
    });

    for (const expectedStatus of [401, 403]) {
      const error = await client.request("listAcademicCourses").catch((value: unknown) => value);
      expect(error).toBeInstanceOf(GopherApiError);
      expect(error).toMatchObject({
        problem: {
          detail: "The server returned an error without valid RFC 9457 details.",
          status: expectedStatus,
        },
        status: expectedStatus,
      });
    }
  });

  it("rejects malformed success JSON instead of casting it to the response type", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("{not-json", { headers: { "content-type": "application/json" }, status: 200 }),
      );
    const client = new GopherClient({ baseUrl, fetch: fetchMock });

    const error = await client.request("getHealth").catch((value: unknown) => value);

    expect(error).toBeInstanceOf(GopherProtocolError);
    expect(error).toMatchObject({
      code: "malformed-success-json",
      operationId: "getHealth",
      status: 200,
    });
  });

  it("rejects structurally invalid implemented success bodies as protocol errors", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response([{}]))
      .mockResolvedValueOnce(response({ items: [{}], nextCursor: null }))
      .mockResolvedValueOnce(response({ ...validManifest, unexpected: true }));
    const client = new GopherClient({ baseUrl, fetch: fetchMock });

    await expect(client.request("getHealth")).rejects.toMatchObject({
      code: "invalid-success-body",
      name: "GopherProtocolError",
      operationId: "getHealth",
      status: 200,
    });
    await expect(client.request("listCampuses")).rejects.toMatchObject({
      code: "invalid-success-body",
      name: "GopherProtocolError",
      operationId: "listCampuses",
    });
    await expect(client.request("listSources")).rejects.toMatchObject({
      code: "invalid-success-body",
      name: "GopherProtocolError",
      operationId: "listSources",
    });
    await expect(client.request("getWorldManifest", { path: { campusId: "tc" } })).rejects.toMatchObject({
      code: "invalid-success-body",
      name: "GopherProtocolError",
      operationId: "getWorldManifest",
    });
  });

  it("rejects undeclared fields throughout implemented response bodies", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ ...validHealth, extra: true }))
      .mockResolvedValueOnce(response([{ ...validCampus, extra: true }]))
      .mockResolvedValueOnce(response({ items: [{ ...validSource, extra: true }], nextCursor: null }))
      .mockResolvedValueOnce(response({ ...validManifest, extra: true }));
    const client = new GopherClient({ baseUrl, fetch: fetchMock });

    await expect(client.request("getHealth")).rejects.toMatchObject({ code: "invalid-success-body" });
    await expect(client.request("listCampuses")).rejects.toMatchObject({ code: "invalid-success-body" });
    await expect(client.request("listSources")).rejects.toMatchObject({ code: "invalid-success-body" });
    await expect(client.request("getWorldManifest", { path: { campusId: "tc" } })).rejects.toMatchObject({
      code: "invalid-success-body",
    });
  });

  it("enforces declared HTTPS, date-time, enum, and source conditional constraints", async () => {
    const invalidBodies = [
      [{ ...validCampus, sourceUrl: "http://twin-cities.umn.edu/" }],
      { items: [{ ...validSource, lastCheckedAt: "July 19" }], nextCursor: null },
      { items: [{ ...validSource, freshnessState: "CURRENT" }], nextCursor: null },
      {
        items: [
          {
            ...validSource,
            cachePolicy: "CACHE_ALLOWED",
            licenseStatus: "PROHIBITED",
          },
        ],
        nextCursor: null,
      },
    ];
    const fetchMock = vi.fn<typeof fetch>();
    for (const body of invalidBodies) fetchMock.mockResolvedValueOnce(response(body));
    const client = new GopherClient({ baseUrl, fetch: fetchMock });

    await expect(client.request("listCampuses")).rejects.toMatchObject({ code: "invalid-success-body" });
    await expect(client.request("listSources")).rejects.toMatchObject({ code: "invalid-success-body" });
    await expect(client.request("listSources")).rejects.toMatchObject({ code: "invalid-success-body" });
    await expect(client.request("listSources")).rejects.toMatchObject({ code: "invalid-success-body" });
  });

  it("enforces only the world constraints declared by OpenAPI", async () => {
    const validTile = {
      bounds: [-93.3, 44.9, -93.2, 45],
      byteLength: 1024,
      contentType: "model/gltf-binary",
      id: "tile-1",
      licenseStatus: "OPEN_REUSE",
      maxZoom: 18,
      minZoom: 12,
      sha256: "a".repeat(64),
      url: "https://assets.example.test/tile.glb",
      verificationState: "schematic",
    } as const;
    const validPortal = {
      fromCampusId: "tc",
      id: "portal-1",
      label: { en: "Duluth", "zh-CN": "德卢斯" },
      position: [-93.23, 44.98, 260],
      targetWorldVersion: "duluth-schematic-v1",
      toCampusId: "duluth",
      verificationState: "schematic",
    } as const;
    const invalidManifests = [
      { ...validManifest, generatedAt: "not-a-date" },
      { ...validManifest, tiles: [{ ...validTile, url: "not a URI" }] },
      { ...validManifest, tiles: [{ ...validTile, maxZoom: 25 }] },
      { ...validManifest, tiles: [{ ...validTile, bounds: [-93.3, 44.9, -93.2] }] },
      { ...validManifest, portals: [{ ...validPortal, position: [-93.23, 44.98] }] },
    ];
    const fetchMock = vi.fn<typeof fetch>();
    for (const manifest of invalidManifests) fetchMock.mockResolvedValueOnce(response(manifest));
    const client = new GopherClient({ baseUrl, fetch: fetchMock });

    for (const manifest of invalidManifests) {
      void manifest;
      await expect(client.request("getWorldManifest", { path: { campusId: "tc" } })).rejects.toMatchObject({
        code: "invalid-success-body",
      });
    }
  });

  it("accepts OpenAPI-valid edge cases without imposing or transforming domain rules", async () => {
    const edgeCampus = {
      ...validCampus,
      academicCalendarCampusId: "rochester",
      academicInstitutionCode: "UMNDL",
      name: { en: " ", "zh-CN": " " },
      timeZone: "",
    } as const;
    const edgeSource = {
      ...validSource,
      id: "abc",
      lastCheckedAt: "2026-07-19T12:00:00-05:00",
      name: { en: " ", "zh-CN": " " },
      publisher: "  ",
    } as const;
    const edgeTile = {
      bounds: [1000, 1000, -1000, -1000],
      byteLength: 1,
      contentType: "",
      id: "",
      licenseStatus: "OPEN_REUSE",
      maxZoom: 0,
      minZoom: 24,
      sha256: "b".repeat(64),
      url: "ftp://assets.example.test/tile.glb",
      verificationState: "schematic",
    } as const;
    const edgePortal = {
      fromCampusId: "morris",
      id: "",
      label: { en: " ", "zh-CN": " " },
      position: [999, -999, 0],
      targetWorldVersion: "",
      toCampusId: "morris",
      verificationState: "schematic",
    } as const;
    const edgeManifest = {
      ...validManifest,
      etag: "",
      generatedAt: "2026-07-19T12:00:00-05:00",
      portals: [edgePortal],
      sourceIds: [""],
      tiles: [edgeTile],
      worldVersion: "",
    } as const;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response([edgeCampus]))
      .mockResolvedValueOnce(response({ items: [edgeSource], nextCursor: "" }))
      .mockResolvedValueOnce(response(edgeManifest));
    const client = new GopherClient({ baseUrl, fetch: fetchMock });

    await expect(client.request("listCampuses")).resolves.toMatchObject({ data: [edgeCampus] });
    await expect(client.request("listSources")).resolves.toMatchObject({
      data: { items: [edgeSource], nextCursor: "" },
    });
    await expect(client.request("getWorldManifest", { path: { campusId: "tc" } })).resolves.toMatchObject({
      data: edgeManifest,
    });
  });

  it("returns validated implemented success bodies", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(validHealth))
      .mockResolvedValueOnce(response([validCampus]))
      .mockResolvedValueOnce(response({ items: [validSource], nextCursor: null }))
      .mockResolvedValueOnce(response(validManifest));
    const client = new GopherClient({ baseUrl, fetch: fetchMock });

    await expect(client.request("getHealth")).resolves.toMatchObject({ data: validHealth });
    await expect(client.request("listCampuses")).resolves.toMatchObject({ data: [validCampus] });
    await expect(client.request("listSources")).resolves.toMatchObject({
      data: { items: [validSource], nextCursor: null },
    });
    await expect(client.request("getWorldManifest", { path: { campusId: "tc" } })).resolves.toMatchObject({
      data: validManifest,
    });
  });

  it("rejects undeclared successful statuses and content types", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ status: "ok" }, { status: 202 }))
      .mockResolvedValueOnce(new Response("ok", { headers: { "content-type": "text/plain" }, status: 200 }));
    const client = new GopherClient({ baseUrl, fetch: fetchMock });

    await expect(client.request("getHealth")).rejects.toMatchObject({
      code: "unexpected-success-status",
      status: 202,
    });
    await expect(client.request("getHealth")).rejects.toMatchObject({
      code: "unexpected-success-content-type",
      status: 200,
    });
  });

  it("rejects an error status that the selected operation does not declare", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      response(
        {
          detail: "Unexpected status.",
          instance: "/v1/health",
          status: 418,
          title: "Teapot",
          traceId: "trace-418",
          type: "about:blank",
        },
        { headers: { "content-type": "application/problem+json" }, status: 418 },
      ),
    );
    const client = new GopherClient({ baseUrl, fetch: fetchMock });

    await expect(client.request("getHealth")).rejects.toMatchObject({
      code: "unexpected-error-status",
      operationId: "getHealth",
      status: 418,
    });
  });

  it("accepts 304 only when the operation declares it", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(undefined, { status: 304 }));
    const client = new GopherClient({ baseUrl, fetch: fetchMock });

    await expect(client.request("getHealth")).rejects.toMatchObject({
      code: "unexpected-not-modified",
      operationId: "getHealth",
      status: 304,
    });

    await expect(client.request("listCampuses")).rejects.toMatchObject({
      code: "unexpected-not-modified",
      operationId: "listCampuses",
      status: 304,
    });
  });

  it("forwards AbortSignal to native fetch", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (request) => {
      expect(request).toBeInstanceOf(Request);
      expect((request as Request).signal.aborted).toBe(true);
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    const client = new GopherClient({ baseUrl, fetch: fetchMock });

    controller.abort();
    await expect(client.request("getHealth", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("allowlists locale while rejecting request-shaping headers case-insensitively", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response(validHealth));
    const client = new GopherClient({ baseUrl, fetch: fetchMock });

    for (const name of [
      "Cookie",
      "x-HTTP-method-override",
      "X-Method-Override",
      "x-original-url",
      "X-Rewrite-URL",
      "x-forwarded-prefix",
      "X-Real-IP",
    ]) {
      await expect(client.request("getHealth", { headers: { [name]: "unsafe" } })).rejects.toThrow(
        /not an allowed additional request header/u,
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();

    await client.request("getHealth", { headers: { "ACCEPT-language": "zh-CN" } });
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.headers.get("accept-language")).toBe("zh-CN");
    expect(request.redirect).toBe("error");
  });

  it("rejects dedicated protocol options on operations that do not declare them", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new GopherClient({ baseUrl, fetch: fetchMock });
    const unsafeClient = client as unknown as {
      request(operationId: string, options?: Record<string, unknown>): Promise<unknown>;
    };

    await expect(unsafeClient.request("getHealth", { etag: '"undeclared"' })).rejects.toThrow(
      /does not accept etag/u,
    );
    await expect(
      unsafeClient.request("getHealth", {
        idempotencyKey: "018fb9d8-3ec5-7e8b-a512-35f8ff523118",
      }),
    ).rejects.toThrow(/does not accept idempotencyKey/u);
    await expect(unsafeClient.request("getHealth", { ifMatch: '"undeclared"' })).rejects.toThrow(
      /does not accept ifMatch/u,
    );
    await expect(unsafeClient.request("getHealth", { vaultReadProof: "A".repeat(64) })).rejects.toThrow(
      /does not accept vaultReadProof/u,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unknown operation IDs before a network call", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new GopherClient({ baseUrl, fetch: fetchMock });

    const unsafeClient = client as unknown as {
      request(operationId: string, options?: unknown): Promise<unknown>;
    };
    await expect(unsafeClient.request("notAnOperation", {})).rejects.toThrow(/Unknown operation/u);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
