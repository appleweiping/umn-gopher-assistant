import type { AiQueryRequest, AiQueryResponse } from "@umn-gopher-assistant/contracts";
import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { AiCircuitBreaker, HttpAiKnowledgeClient } from "../src/ai/ai-knowledge.client.js";
import { AiUnavailableException } from "../src/http/ai-unavailable.exception.js";

const request: AiQueryRequest = { campusId: "tc", locale: "en", query: "Where is the library?" };
const serviceHmacKey = new TextEncoder().encode("development-only-ai-service-hmac-key-v1");
const response: AiQueryResponse = {
  campusId: "tc",
  citations: [
    {
      campusId: "tc",
      category: "library",
      contentSha256: "a".repeat(64),
      documentId: "tc-library-overview",
      excerpt: "A project-authored summary of the official library entry point.",
      id: "citation-1",
      summaryFreshnessState: "FRESH",
      summarySource: {
        kind: "project-authored-summary",
        sourceId: "uga-ai-summary-corpus-v1",
        sourceUrl:
          "https://github.com/appleweiping/umn-gopher-assistant/blob/main/apps/ai-knowledge/ai_knowledge/data/corpus.json",
        corpusSha256: "c".repeat(64),
        license: {
          status: "OPEN_REUSE",
          spdxId: "Apache-2.0",
          evidenceUrl: "https://www.apache.org/licenses/LICENSE-2.0",
        },
      },
      summaryVerificationState: "schematic",
      title: { en: "Libraries", "zh-CN": "图书馆" },
      updatedAt: "2026-07-22T00:00:00.000Z",
      verificationLink: {
        kind: "official-verification-link",
        sourceId: "official-tc-library",
        sourceUrl: "https://www.lib.umn.edu/",
        licenseStatus: "DEEPLINK_ONLY",
        sourceUse: "verification-link-only",
        contentRetrieved: false,
      },
    },
  ],
  locale: "en",
  paragraphs: [
    {
      citationIds: ["citation-1"],
      id: "paragraph-1",
      text: "Use the official library entry point for current hours and locations.",
    },
  ],
  queryId: "00000000-0000-4000-8000-000000000001",
  retrieval: { documentsConsidered: 5, mode: "no-key-hybrid" },
  state: "answered",
};
const responseCitation = response.citations[0];
if (responseCitation === undefined) {
  throw new Error("AI client fixture must include a citation");
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}

describe("HTTP AI knowledge client", () => {
  it("uses a bounded credential-free request and accepts the strict evidence contract", async () => {
    let captured: Request | undefined;
    const client = new HttpAiKnowledgeClient({
      baseUrl: new URL("http://127.0.0.1:8100/base"),
      fetch: async (input) => {
        captured = input instanceof Request ? input : new Request(input);
        return jsonResponse(response);
      },
      maxResponseBytes: 32_768,
      nonceSource: () => new Uint8Array(16).fill(1),
      requestClock: () => 1_753_248_000_000,
      serviceHmacKey,
      timeoutMs: 1_000,
    });

    await expect(client.query(request, "trace-ai-client-1")).resolves.toEqual(response);
    expect(captured?.url).toBe("http://127.0.0.1:8100/base/v1/query");
    expect(captured?.method).toBe("POST");
    expect(captured?.credentials).toBe("omit");
    expect(captured?.redirect).toBe("error");
    expect(captured?.headers.has("authorization")).toBe(false);
    expect(captured?.headers.get("x-request-id")).toBe("trace-ai-client-1");
    expect(captured?.headers.get("x-ai-service-timestamp")).toBe("1753248000");
    expect(captured?.headers.get("x-ai-service-nonce")).toBe("AQEBAQEBAQEBAQEBAQEBAQ");
    const requestBody = JSON.stringify(request);
    const bodySha256 = createHash("sha256").update(requestBody).digest("hex");
    const canonical = `POST\n/v1/query\n${bodySha256}\ntrace-ai-client-1\n1753248000\nAQEBAQEBAQEBAQEBAQEBAQ`;
    expect(captured?.headers.get("x-ai-service-signature")).toBe(
      createHmac("sha256", serviceHmacKey).update(canonical).digest("hex"),
    );
    await expect(captured?.json()).resolves.toEqual(request);
  });

  it("uses a fresh 128-bit nonce for concurrent identical signed requests", async () => {
    const captured: Request[] = [];
    let nonceByte = 0;
    const client = new HttpAiKnowledgeClient({
      baseUrl: new URL("http://127.0.0.1:8100"),
      fetch: async (input) => {
        captured.push(input instanceof Request ? input : new Request(input));
        return jsonResponse(response);
      },
      maxResponseBytes: 32_768,
      nonceSource: () => new Uint8Array(16).fill((nonceByte += 1)),
      requestClock: () => 1_753_248_000_000,
      serviceHmacKey,
      timeoutMs: 1_000,
    });

    await expect(
      Promise.all([
        client.query(request, "trace-ai-client-concurrent"),
        client.query(request, "trace-ai-client-concurrent"),
      ]),
    ).resolves.toEqual([response, response]);
    const nonces = captured.map((item) => item.headers.get("x-ai-service-nonce"));
    const signatures = captured.map((item) => item.headers.get("x-ai-service-signature"));
    expect(nonces).toHaveLength(2);
    expect(nonces[0]).toMatch(/^[A-Za-z0-9_-]{22}$/u);
    expect(nonces[1]).toMatch(/^[A-Za-z0-9_-]{22}$/u);
    expect(new Set(nonces).size).toBe(2);
    expect(new Set(signatures).size).toBe(2);
  });

  it("rejects an invalid nonce source before calling the private service", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new HttpAiKnowledgeClient({
      baseUrl: new URL("http://127.0.0.1:8100"),
      fetch: fetchMock,
      maxResponseBytes: 32_768,
      nonceSource: () => new Uint8Array(15),
      serviceHmacKey,
      timeoutMs: 1_000,
    });

    await expect(client.query(request, "trace-ai-client-bad-nonce")).rejects.toThrow("exactly 128 bits");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown field", { ...response, privatePrompt: "do not leak" }],
    ["cross-campus citation", { ...response, citations: [{ ...response.citations[0], campusId: "duluth" }] }],
    [
      "collapsed provenance roles",
      {
        ...response,
        citations: [
          {
            ...responseCitation,
            verificationLink: {
              ...responseCitation.verificationLink,
              sourceId: responseCitation.summarySource.sourceId,
            },
          },
        ],
      },
    ],
    [
      "uncited paragraph",
      { ...response, paragraphs: [{ ...response.paragraphs[0], citationIds: ["missing"] }] },
    ],
  ])("fails closed on %s", async (_label, body) => {
    const client = new HttpAiKnowledgeClient({
      baseUrl: new URL("http://127.0.0.1:8100"),
      fetch: async () => jsonResponse(body),
      maxResponseBytes: 32_768,
      serviceHmacKey,
      timeoutMs: 1_000,
    });
    await expect(client.query(request, "trace-ai-client-2")).rejects.toMatchObject({
      failureCode: "AI_UPSTREAM_PROTOCOL",
      status: 503,
    });
  });

  it("rejects oversized bodies before parsing and does not reflect upstream content", async () => {
    const secret = "upstream-secret-that-must-not-escape";
    const client = new HttpAiKnowledgeClient({
      baseUrl: new URL("http://127.0.0.1:8100"),
      fetch: async () =>
        new Response(JSON.stringify({ secret }), {
          headers: { "content-length": "40000", "content-type": "application/json" },
        }),
      maxResponseBytes: 16_384,
      serviceHmacKey,
      timeoutMs: 1_000,
    });
    let caught: unknown;
    try {
      await client.query(request, "trace-ai-client-3");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AiUnavailableException);
    expect(JSON.stringify(caught)).not.toContain(secret);
  });

  it.each([
    ["private contract rejection", 422, "application/json", undefined],
    ["non-success status", 503, "application/json", undefined],
    ["unexpected media type", 200, "text/plain", undefined],
    ["malformed declared length", 200, "application/json", "not-a-number"],
    ["oversized declared length", 200, "application/json", "40000"],
  ])("best-effort cancels an unconsumed body for %s", async (_label, status, contentType, contentLength) => {
    const headers = new Headers({ "content-type": contentType });
    if (contentLength !== undefined) headers.set("content-length", contentLength);
    const upstream = new Response("unconsumed-upstream-body", { headers, status });
    if (upstream.body === null) throw new Error("The cancellation fixture must have a body");
    const cancel = vi.spyOn(upstream.body, "cancel");
    const client = new HttpAiKnowledgeClient({
      baseUrl: new URL("http://127.0.0.1:8100"),
      fetch: async () => upstream,
      maxResponseBytes: 16_384,
      serviceHmacKey,
      timeoutMs: 1_000,
    });

    await expect(client.query(request, "trace-ai-client-cancel")).rejects.toBeInstanceOf(
      AiUnavailableException,
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("opens after three failures and permits one half-open probe", async () => {
    let now = 1_000;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValue(jsonResponse(response));
    const client = new HttpAiKnowledgeClient({
      baseUrl: new URL("http://127.0.0.1:8100"),
      fetch: fetchMock,
      maxResponseBytes: 32_768,
      now: () => now,
      serviceHmacKey,
      timeoutMs: 1_000,
    });

    for (let index = 0; index < 3; index += 1) {
      await expect(client.query(request, "trace-ai-client-4")).rejects.toBeInstanceOf(AiUnavailableException);
    }
    await expect(client.query(request, "trace-ai-client-4")).rejects.toMatchObject({
      failureCode: "AI_CIRCUIT_OPEN",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    now += 30_001;
    await expect(client.query(request, "trace-ai-client-4")).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("does not open the shared circuit when the private service rejects a request", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 422 }));
    const client = new HttpAiKnowledgeClient({
      baseUrl: new URL("http://127.0.0.1:8100"),
      fetch: fetchMock,
      maxResponseBytes: 32_768,
      serviceHmacKey,
      timeoutMs: 1_000,
    });

    for (let index = 0; index < 4; index += 1) {
      await expect(client.query(request, "trace-ai-client-5")).rejects.toMatchObject({
        failureCode: "AI_UPSTREAM_CONTRACT_DRIFT",
      });
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe("AI circuit breaker", () => {
  it("allows only one half-open probe", () => {
    let now = 0;
    const breaker = new AiCircuitBreaker({ cooldownMs: 1_000, failureThreshold: 1, now: () => now });
    const first = breaker.acquire();
    breaker.failure(first.probe);
    now = 1_001;
    expect(breaker.acquire()).toEqual({ probe: true });
    expect(() => breaker.acquire()).toThrow(AiUnavailableException);
  });

  it("reports the actual remaining cooldown", () => {
    let now = 0;
    const breaker = new AiCircuitBreaker({ cooldownMs: 5_000, failureThreshold: 1, now: () => now });
    const lease = breaker.acquire();
    breaker.failure(lease.probe);
    now = 3_100;
    expect(() => breaker.acquire()).toThrow(expect.objectContaining({ retryAfterSeconds: 2 }));
  });
});
