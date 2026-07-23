// @vitest-environment node

import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { handleAiQueryProxy } from "../lib/ai/bff";
import {
  AI_INGRESS_NETWORK_HEADER,
  AI_INGRESS_PROOF_EXPIRES_HEADER,
  AI_INGRESS_PROOF_HEADER,
  AI_INTERNAL_NETWORK_HEADER,
  AI_INTERNAL_PROOF_EXPIRES_HEADER,
  AI_INTERNAL_PROOF_HEADER,
  AI_INTERNAL_SESSION_HEADER,
  AI_SESSION_COOKIE_NAME,
} from "../lib/ai/session";
import { aiResponse } from "./ai-fixtures";

const requestBody = JSON.stringify({ campusId: "tc", locale: "en", query: "When is the library open?" });

function aiRequest(
  overrides: {
    readonly body?: string;
    readonly contentLength?: string | null;
    readonly contentType?: string;
    readonly cookie?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly origin?: string | null;
  } = {},
): Request {
  const body = overrides.body ?? requestBody;
  const headers = new Headers({
    "Content-Type": overrides.contentType ?? "application/json",
    Origin: overrides.origin === undefined ? "https://assistant.example" : (overrides.origin ?? ""),
  });
  if (overrides.origin === null) headers.delete("Origin");
  if (overrides.cookie !== undefined) headers.set("Cookie", overrides.cookie);
  for (const [name, value] of Object.entries(overrides.headers ?? {})) headers.set(name, value);
  if (overrides.contentLength !== null) {
    headers.set(
      "Content-Length",
      overrides.contentLength ?? String(new TextEncoder().encode(body).byteLength),
    );
  }
  return new Request("https://assistant.example/api/ai/query", {
    body,
    headers,
    method: "POST",
  });
}

const productionEnvironment = {
  GOPHER_AI_INGRESS_ASSERTION_HMAC_KEY: Buffer.alloc(32, 3).toString("base64url"),
  GOPHER_AI_SESSION_COOKIE_HMAC_KEY: Buffer.alloc(32, 1).toString("base64url"),
  GOPHER_API_BASE_URL: "https://api.internal.example",
  INTERNAL_AI_BFF_PROOF_HMAC_KEY: Buffer.alloc(32, 2).toString("base64url"),
  NODE_ENV: "production",
} as NodeJS.ProcessEnv;

function ingressHeaders(networkId: string, expiresAt: number): Record<string, string> {
  const proof = createHmac(
    "sha256",
    Buffer.from(productionEnvironment["GOPHER_AI_INGRESS_ASSERTION_HMAC_KEY"] ?? "", "base64url"),
  )
    .update(
      `umn-gopher-assistant:ai-ingress-network:v1\nPOST\n/api/ai/query\n${networkId}\n${String(expiresAt)}`,
      "utf8",
    )
    .digest("base64url");
  return {
    [AI_INGRESS_NETWORK_HEADER]: `v1.${networkId}`,
    [AI_INGRESS_PROOF_EXPIRES_HEADER]: String(expiresAt),
    [AI_INGRESS_PROOF_HEADER]: `v1.${proof}`,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("AI same-origin BFF", () => {
  it("forwards only the validated query and reserializes a contract-valid response", async () => {
    vi.stubEnv("GOPHER_API_BASE_URL", "https://api.internal.example");
    const upstreamFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(aiResponse(), { headers: { "set-cookie": "never=forward" } }));
    const request = aiRequest();
    request.headers.set("Authorization", "Bearer browser-token-must-not-cross-bff");
    request.headers.set(AI_INTERNAL_NETWORK_HEADER, `v1.${"B".repeat(43)}`);
    request.headers.set(AI_INTERNAL_SESSION_HEADER, "v1.attacker-session");
    request.headers.set(AI_INTERNAL_PROOF_EXPIRES_HEADER, "9999999999");
    request.headers.set(AI_INTERNAL_PROOF_HEADER, `v1.${"A".repeat(43)}`);

    const response = await handleAiQueryProxy(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain(`${AI_SESSION_COOKIE_NAME}=v1.`);
    expect(response.headers.get("set-cookie")).toContain("Path=/api/ai");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(await response.json()).toEqual(aiResponse());
    expect(upstreamFetch).toHaveBeenCalledOnce();
    const [url, init] = upstreamFetch.mock.calls[0] ?? [];
    expect((url as URL).href).toBe("https://api.internal.example/v1/ai/query");
    expect(init).toMatchObject({
      cache: "no-store",
      credentials: "omit",
      method: "POST",
      redirect: "error",
    });
    expect((init?.headers as Record<string, string>)["Authorization"]).toBeUndefined();
    expect((init?.headers as Record<string, string>)["Cookie"]).toBeUndefined();
    expect((init?.headers as Record<string, string>)[AI_INTERNAL_SESSION_HEADER]).toMatch(
      /^v1\.[A-Za-z0-9_-]{22}$/u,
    );
    expect((init?.headers as Record<string, string>)[AI_INTERNAL_SESSION_HEADER]).not.toBe(
      "v1.attacker-session",
    );
    expect((init?.headers as Record<string, string>)[AI_INTERNAL_NETWORK_HEADER]).toMatch(
      /^v1\.[A-Za-z0-9_-]{43}$/u,
    );
    expect((init?.headers as Record<string, string>)[AI_INTERNAL_NETWORK_HEADER]).not.toBe(
      `v1.${"B".repeat(43)}`,
    );
    expect((init?.headers as Record<string, string>)[AI_INTERNAL_PROOF_EXPIRES_HEADER]).toMatch(
      /^[1-9]\d{9}$/u,
    );
    expect((init?.headers as Record<string, string>)[AI_INTERNAL_PROOF_HEADER]).toMatch(
      /^v1\.[A-Za-z0-9_-]{43}$/u,
    );
    const forwardedTraceId = (init?.headers as Record<string, string>)["X-Request-Id"];
    expect(forwardedTraceId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(response.headers.get("x-request-id")).toBe(forwardedTraceId);
    expect(JSON.parse(init?.body as string)).toEqual({
      campusId: "tc",
      locale: "en",
      query: "When is the library open?",
    });
  });

  it.each([
    {
      label: "an unknown response field",
      response: { ...aiResponse(), unexpected: "must-fail-closed" },
    },
    {
      label: "a cross-campus citation",
      response: {
        ...aiResponse(),
        citations: [{ ...aiResponse().citations[0], campusId: "duluth" }],
      },
    },
  ])("rejects $label", async ({ response: upstreamBody }) => {
    vi.stubEnv("GOPHER_API_BASE_URL", "https://api.internal.example");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(upstreamBody));

    const response = await handleAiQueryProxy(aiRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      failureCode: "INVALID_AI_UPSTREAM_RESPONSE",
      status: 502,
    });
  });

  it.each([
    ["unexpected media type", { "Content-Type": "text/plain" }],
    [
      "oversized declared response",
      { "Content-Length": String(512 * 1024 + 1), "Content-Type": "application/json" },
    ],
  ])("best-effort cancels an unconsumed upstream body for %s", async (_label, headers) => {
    vi.stubEnv("GOPHER_API_BASE_URL", "https://api.internal.example");
    const upstream = new Response("unconsumed upstream body", { headers });
    if (upstream.body === null) throw new Error("The cancellation fixture must have a response body");
    const cancel = vi.spyOn(upstream.body, "cancel");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(upstream);

    const response = await handleAiQueryProxy(aiRequest());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      failureCode: "INVALID_AI_UPSTREAM_RESPONSE",
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects cross-origin, non-JSON, malformed-length, and oversized requests before fetching", async () => {
    const upstreamFetch = vi.spyOn(globalThis, "fetch");
    const cases = [
      aiRequest({ origin: "https://evil.example" }),
      aiRequest({ origin: null }),
      aiRequest({ contentType: "text/plain" }),
      aiRequest({ contentLength: "01" }),
      aiRequest({ contentLength: "9000" }),
    ];

    for (const request of cases) {
      const response = await handleAiQueryProxy(request);
      expect([400, 403, 413, 415]).toContain(response.status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("set-cookie")).toContain(`${AI_SESSION_COOKIE_NAME}=v1.`);
    }
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("sanitizes upstream error bodies and forwards only a bounded Retry-After", async () => {
    vi.stubEnv("GOPHER_API_BASE_URL", "https://api.internal.example");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        {
          detail: "redis://admin:super-secret@internal.service/0",
          stack: "internal stack trace",
        },
        {
          headers: {
            "Retry-After": "45",
            "RateLimit-Limit": "12",
            "RateLimit-Remaining": "0",
            "RateLimit-Reset": "11",
            "X-Debug": "private",
            "X-Request-Id": "trace-core-api-error",
          },
          status: 503,
        },
      ),
    );

    const response = await handleAiQueryProxy(aiRequest());
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("45");
    expect(response.headers.get("ratelimit-limit")).toBe("12");
    expect(response.headers.get("ratelimit-remaining")).toBe("0");
    expect(response.headers.get("ratelimit-reset")).toBe("11");
    expect(response.headers.get("x-request-id")).toBe("trace-core-api-error");
    expect(response.headers.get("set-cookie")).toContain(`${AI_SESSION_COOKIE_NAME}=v1.`);
    expect(response.headers.has("x-debug")).toBe(false);
    expect(body).not.toContain("redis://");
    expect(body).not.toContain("stack trace");
    expect(body).toContain("AI_SERVICE_UNAVAILABLE");
    expect(body).toContain("trace-core-api-error");
  });

  it("preserves validated upstream trace and rate-limit metadata on success", async () => {
    vi.stubEnv("GOPHER_API_BASE_URL", "https://api.internal.example");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(aiResponse(), {
        headers: {
          "RateLimit-Limit": "12",
          "RateLimit-Remaining": "7",
          "RateLimit-Reset": "29",
          "X-Request-Id": "trace-core-api-success",
        },
      }),
    );

    const response = await handleAiQueryProxy(aiRequest());

    expect(response.headers.get("x-request-id")).toBe("trace-core-api-success");
    expect(response.headers.get("ratelimit-limit")).toBe("12");
    expect(response.headers.get("ratelimit-remaining")).toBe("7");
    expect(response.headers.get("ratelimit-reset")).toBe("29");
  });

  it("keeps one valid cookie in one client bucket and separates independent sessions", async () => {
    vi.stubEnv("GOPHER_API_BASE_URL", "https://api.internal.example");
    const upstreamFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(Response.json(aiResponse())));
    const fixedNow = Date.UTC(2026, 6, 23, 0, 0, 0);

    const firstResponse = await handleAiQueryProxy(aiRequest(), {
      now: () => fixedNow,
      randomBytes: () => new Uint8Array(16).fill(1),
    });
    const firstCookie = firstResponse.headers.get("set-cookie")?.split(";", 1)[0];
    if (firstCookie === undefined) throw new Error("The first anonymous request must issue a cookie");
    const secondResponse = await handleAiQueryProxy(aiRequest({ cookie: firstCookie }), {
      now: () => fixedNow + 1_000,
      randomBytes: () => new Uint8Array(16).fill(9),
    });
    const thirdResponse = await handleAiQueryProxy(aiRequest(), {
      now: () => fixedNow + 1_000,
      randomBytes: () => new Uint8Array(16).fill(2),
    });

    expect(secondResponse.headers.has("set-cookie")).toBe(false);
    expect(thirdResponse.headers.get("set-cookie")).toContain(`${AI_SESSION_COOKIE_NAME}=v1.`);
    const firstHeaders = upstreamFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const secondHeaders = upstreamFetch.mock.calls[1]?.[1]?.headers as Record<string, string>;
    const thirdHeaders = upstreamFetch.mock.calls[2]?.[1]?.headers as Record<string, string>;
    expect(secondHeaders[AI_INTERNAL_SESSION_HEADER]).toBe(firstHeaders[AI_INTERNAL_SESSION_HEADER]);
    expect(thirdHeaders[AI_INTERNAL_SESSION_HEADER]).not.toBe(firstHeaders[AI_INTERNAL_SESSION_HEADER]);
    expect(secondHeaders[AI_INTERNAL_PROOF_HEADER]).not.toBe(firstHeaders[AI_INTERNAL_PROOF_HEADER]);
  });

  it("keeps the trusted network bucket stable when a browser clears its session cookie", async () => {
    const upstreamFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(Response.json(aiResponse())));
    const fixedNow = Date.UTC(2026, 6, 23, 0, 0, 0);
    const networkId = Buffer.alloc(32, 8).toString("base64url");
    const headers = ingressHeaders(networkId, Math.floor(fixedNow / 1_000) + 30);

    const first = await handleAiQueryProxy(aiRequest({ headers }), {
      environment: productionEnvironment,
      now: () => fixedNow,
      randomBytes: () => new Uint8Array(16).fill(1),
    });
    const afterCookieClear = await handleAiQueryProxy(aiRequest({ headers }), {
      environment: productionEnvironment,
      now: () => fixedNow,
      randomBytes: () => new Uint8Array(16).fill(2),
    });

    expect(first.status).toBe(200);
    expect(afterCookieClear.status).toBe(200);
    const firstHeaders = upstreamFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const secondHeaders = upstreamFetch.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(secondHeaders[AI_INTERNAL_SESSION_HEADER]).not.toBe(firstHeaders[AI_INTERNAL_SESSION_HEADER]);
    expect(secondHeaders[AI_INTERNAL_NETWORK_HEADER]).toBe(firstHeaders[AI_INTERNAL_NETWORK_HEADER]);
    expect(secondHeaders[AI_INTERNAL_NETWORK_HEADER]).toBe(`v1.${networkId}`);
  });

  it("fails closed before fetch when production lacks a valid ingress assertion", async () => {
    const upstreamFetch = vi.spyOn(globalThis, "fetch");
    const response = await handleAiQueryProxy(aiRequest(), {
      environment: productionEnvironment,
      now: () => Date.UTC(2026, 6, 23, 0, 0, 0),
      randomBytes: () => new Uint8Array(16).fill(1),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toContain(`${AI_SESSION_COOKIE_NAME}=v1.`);
    await expect(response.json()).resolves.toMatchObject({
      failureCode: "AI_INGRESS_ASSERTION_REQUIRED",
      status: 503,
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("rejects a response for a different requested campus or locale", async () => {
    vi.stubEnv("GOPHER_API_BASE_URL", "https://api.internal.example");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        aiResponse({
          campusId: "duluth",
          citations: [
            {
              ...aiCitationForDuluth(),
              campusId: "duluth",
              id: "duluth-library-hours",
              sourceId: "duluth-library-knowledge",
            },
          ],
          paragraphs: [
            {
              citationIds: ["duluth-library-hours"],
              id: "paragraph-duluth",
              text: "Duluth evidence.",
            },
          ],
        }),
      ),
    );

    const response = await handleAiQueryProxy(aiRequest());
    expect(response.status).toBe(502);
  });
});

function aiCitationForDuluth() {
  const citation = aiResponse().citations[0];
  if (citation === undefined) throw new Error("The AI test fixture must include a citation");
  return citation;
}
