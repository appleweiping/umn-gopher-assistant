import { createHmac } from "node:crypto";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { AiQueryRequest, AiQueryResponse } from "@umn-gopher-assistant/contracts";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AI_KNOWLEDGE_CLIENT, AI_RATE_LIMITER } from "../src/ai/ai.tokens.js";
import {
  AI_INTERNAL_PROOF_EXPIRES_HEADER,
  AI_INTERNAL_PROOF_HEADER,
  AI_INTERNAL_NETWORK_HEADER,
  AI_INTERNAL_SESSION_HEADER,
} from "../src/ai/ai-client-session-proof.js";
import type { AiKnowledgeClient, AiRateLimitDecision, AiRateLimiter } from "../src/ai/ai.types.js";
import { AppModule } from "../src/app.module.js";
import { AiUnavailableException } from "../src/http/ai-unavailable.exception.js";
import { createFastifyAdapter } from "../src/http/fastify-adapter.js";

const answer: AiQueryResponse = {
  campusId: "tc",
  citations: [
    {
      campusId: "tc",
      category: "library",
      contentSha256: "a".repeat(64),
      excerpt: "Project-authored library guidance linked to the official campus site.",
      freshnessState: "FRESH",
      id: "citation-1",
      sourceId: "ai-tc-library",
      sourceUrl: "https://www.lib.umn.edu/",
      title: { en: "Libraries", "zh-CN": "图书馆" },
      updatedAt: "2026-07-22T00:00:00.000Z",
      verificationState: "schematic",
    },
  ],
  locale: "en",
  paragraphs: [
    {
      citationIds: ["citation-1"],
      id: "paragraph-1",
      text: "Use the official library page to confirm current locations and hours.",
    },
  ],
  queryId: "00000000-0000-4000-8000-000000000001",
  retrieval: { documentsConsidered: 5, mode: "no-key-hybrid" },
  state: "answered",
};

const localProofKey = Buffer.from("development-only-ai-bff-core-proof-hmac-key-v1", "utf8");
const query = { campusId: "tc", locale: "en", query: "Where is the library?" } as const;

function internalProofHeaders(
  sessionId: string,
  traceId: string,
  networkId = Buffer.alloc(32, 9).toString("base64url"),
  expiresAt = Math.floor(Date.now() / 1_000) + 30,
): Record<string, string> {
  const signature = createHmac("sha256", localProofKey)
    .update(
      `umn-gopher-assistant:ai-bff-proof:v2\n${traceId}\n${sessionId}\n${networkId}\n${String(expiresAt)}`,
      "utf8",
    )
    .digest("base64url");
  return {
    [AI_INTERNAL_NETWORK_HEADER]: `v1.${networkId}`,
    [AI_INTERNAL_PROOF_EXPIRES_HEADER]: String(expiresAt),
    [AI_INTERNAL_PROOF_HEADER]: `v1.${signature}`,
    [AI_INTERNAL_SESSION_HEADER]: `v1.${sessionId}`,
    "X-Request-Id": traceId,
  };
}

class FakeKnowledgeClient implements AiKnowledgeClient {
  calls: AiQueryRequest[] = [];
  traceIds: string[] = [];
  error: Error | undefined;

  async query(input: AiQueryRequest, traceId: string): Promise<AiQueryResponse> {
    this.calls.push(input);
    this.traceIds.push(traceId);
    if (this.error !== undefined) throw this.error;
    return answer;
  }
}

class FakeRateLimiter implements AiRateLimiter {
  decision: AiRateLimitDecision = {
    allowed: true,
    limit: 12,
    remaining: 11,
    resetAfterSeconds: 29,
    retryAfterSeconds: 60,
  };
  keys: { readonly clientKey: string; readonly networkKey: string }[] = [];

  async consume(clientKey: string, networkKey: string): Promise<AiRateLimitDecision> {
    this.keys.push({ clientKey, networkKey });
    return this.decision;
  }
}

describe("public AI query endpoint", () => {
  let app: NestFastifyApplication;
  let knowledge: FakeKnowledgeClient;
  let limiter: FakeRateLimiter;

  beforeAll(async () => {
    knowledge = new FakeKnowledgeClient();
    limiter = new FakeRateLimiter();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_KNOWLEDGE_CLIENT)
      .useValue(knowledge)
      .overrideProvider(AI_RATE_LIMITER)
      .useValue(limiter)
      .compile();
    app = module.createNestApplication<NestFastifyApplication>(createFastifyAdapter({ NODE_ENV: "test" }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  beforeEach(() => {
    knowledge.calls = [];
    knowledge.traceIds = [];
    knowledge.error = undefined;
    limiter.decision = {
      allowed: true,
      limit: 12,
      remaining: 11,
      resetAfterSeconds: 29,
      retryAfterSeconds: 60,
    };
    limiter.keys = [];
  });

  afterAll(async () => {
    await app.close();
  });

  it("answers anonymously with no-store and distributed-rate-limit metadata", async () => {
    const result = await request(app.getHttpServer())
      .post("/v1/ai/query")
      .send({ campusId: "tc", locale: "en", query: "  Where is the library?  " })
      .expect(200);

    expect(result.body).toEqual(answer);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.headers["ratelimit-remaining"]).toBe("11");
    expect(result.headers["ratelimit-limit"]).toBe("12");
    expect(result.headers["ratelimit-reset"]).toBe("29");
    expect(knowledge.calls).toEqual([{ campusId: "tc", locale: "en", query: "Where is the library?" }]);
    expect(limiter.keys).toHaveLength(1);
    expect(limiter.keys[0]?.clientKey).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(limiter.keys[0]?.networkKey).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(JSON.stringify(limiter.keys[0])).not.toContain("127.0.0.1");
    expect(knowledge.traceIds).toEqual([result.headers["x-request-id"]]);
  });

  it("uses distinct verified BFF sessions as stable client buckets", async () => {
    const firstSession = Buffer.alloc(16, 1).toString("base64url");
    const secondSession = Buffer.alloc(16, 2).toString("base64url");
    await request(app.getHttpServer())
      .post("/v1/ai/query")
      .set(internalProofHeaders(firstSession, "trace-session-first"))
      .send(query)
      .expect(200);
    await request(app.getHttpServer())
      .post("/v1/ai/query")
      .set(internalProofHeaders(secondSession, "trace-session-second"))
      .send(query)
      .expect(200);
    await request(app.getHttpServer())
      .post("/v1/ai/query")
      .set(internalProofHeaders(firstSession, "trace-session-first-again"))
      .send(query)
      .expect(200);

    expect(limiter.keys).toHaveLength(3);
    expect(limiter.keys[0]?.clientKey).not.toBe(limiter.keys[1]?.clientKey);
    expect(limiter.keys[2]?.clientKey).toBe(limiter.keys[0]?.clientKey);
    expect(limiter.keys[0]?.networkKey).toBe(limiter.keys[1]?.networkKey);
    expect(limiter.keys[2]?.networkKey).toBe(limiter.keys[0]?.networkKey);
  });

  it("falls back to the socket client bucket for invalid proofs without trusting X-Forwarded-For", async () => {
    await request(app.getHttpServer())
      .post("/v1/ai/query")
      .set("X-Forwarded-For", "198.51.100.10")
      .send(query)
      .expect(200);
    const sessionId = Buffer.alloc(16, 3).toString("base64url");
    await request(app.getHttpServer())
      .post("/v1/ai/query")
      .set({
        ...internalProofHeaders(sessionId, "trace-proof-original"),
        "X-Forwarded-For": "203.0.113.20",
        "X-Request-Id": "trace-proof-replayed",
      })
      .send(query)
      .expect(200);
    await request(app.getHttpServer())
      .post("/v1/ai/query")
      .set({
        ...internalProofHeaders(
          sessionId,
          "trace-proof-expired",
          Buffer.alloc(32, 9).toString("base64url"),
          Math.floor(Date.now() / 1_000) - 1,
        ),
        "X-Forwarded-For": "192.0.2.30",
      })
      .send(query)
      .expect(200);

    expect(limiter.keys).toHaveLength(3);
    expect(new Set(limiter.keys.map(({ clientKey }) => clientKey)).size).toBe(1);
    expect(new Set(limiter.keys.map(({ networkKey }) => networkKey)).size).toBe(1);
  });

  it("charges invalid attempts to the abuse budget without reflecting unknown fields", async () => {
    const secret = "private-query-field";
    const result = await request(app.getHttpServer())
      .post("/v1/ai/query")
      .send({ campusId: "tc", locale: "en", query: "Where is the library?", secret })
      .expect(400);

    expect(result.headers["content-type"]).toContain("application/problem+json");
    expect(result.body).toMatchObject({ status: 400, title: "Bad Request" });
    expect(JSON.stringify(result.body)).not.toContain(secret);
    expect(limiter.keys).toHaveLength(1);
    expect(knowledge.calls).toEqual([]);
  });

  it("rejects an oversized AI body before application parsing", async () => {
    const result = await request(app.getHttpServer())
      .post("/v1/ai/query")
      .set("content-type", "application/json")
      .send(JSON.stringify({ campusId: "tc", locale: "en", query: "a".repeat(8_193) }))
      .expect(413);

    expect(result.headers["content-type"]).toContain("application/problem+json");
    expect(result.body).toMatchObject({ status: 413 });
    expect(knowledge.calls).toEqual([]);
  });

  it("returns the documented 415 problem for non-JSON requests", async () => {
    const result = await request(app.getHttpServer())
      .post("/v1/ai/query")
      .set("content-type", "text/plain")
      .send("not-json")
      .expect(415);

    expect(result.headers["content-type"]).toContain("application/problem+json");
    expect(result.body).toMatchObject({ status: 415, title: "Unsupported Media Type" });
    expect(knowledge.calls).toEqual([]);
  });

  it("fails closed with Retry-After when the distributed limiter denies a request", async () => {
    limiter.decision = {
      allowed: false,
      limit: 12,
      remaining: 0,
      resetAfterSeconds: 11,
      retryAfterSeconds: 37,
    };
    const result = await request(app.getHttpServer())
      .post("/v1/ai/query")
      .send({ campusId: "tc", locale: "en", query: "Where is the library?" })
      .expect(429);

    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.headers["ratelimit-limit"]).toBe("12");
    expect(result.headers["ratelimit-remaining"]).toBe("0");
    expect(result.headers["ratelimit-reset"]).toBe("11");
    expect(result.headers["retry-after"]).toBe("37");
    expect(result.body).toMatchObject({ failureCode: "AI_RATE_LIMITED", status: 429 });
    expect(knowledge.calls).toEqual([]);
  });

  it("maps knowledge-service failure to a redacted RFC 9457 response", async () => {
    knowledge.error = new AiUnavailableException("AI_UPSTREAM_UNAVAILABLE", 12);
    const result = await request(app.getHttpServer())
      .post("/v1/ai/query")
      .send({ campusId: "tc", locale: "en", query: "Where is the library?" })
      .expect(503);

    expect(result.headers["retry-after"]).toBe("12");
    expect(result.body).toMatchObject({ failureCode: "AI_UPSTREAM_UNAVAILABLE", status: 503 });
    expect(result.body.traceId).toEqual(expect.any(String));
  });
});
