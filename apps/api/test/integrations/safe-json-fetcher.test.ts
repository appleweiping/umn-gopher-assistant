import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  buildLiveWhaleUrl,
  buildSessionsUrl,
  INTEGRATION_ENDPOINT_IDS,
  IntegrationError,
  ObservedIntegrationError,
  SafeJsonFetcher,
} from "../../src/integrations/index.js";

function jsonResponse(body: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=UTF-8");
  return new Response(body, { ...init, headers });
}

describe("SafeJsonFetcher", () => {
  it("uses only fixed outbound headers and returns a hash-only observation", async () => {
    const raw = JSON.stringify({ sessions: [] });
    const transport = vi.fn(async (_input: string | URL, init: RequestInit) => {
      expect(init.method).toBe("GET");
      expect(init.redirect).toBe("manual");
      expect(init.credentials).toBe("omit");
      expect(init.referrerPolicy).toBe("no-referrer");
      const headers = new Headers(init.headers);
      expect([...headers.entries()]).toEqual([["accept", "application/json"]]);
      expect(headers.has("authorization")).toBe(false);
      expect(headers.has("cookie")).toBe(false);
      expect(headers.has("x-forwarded-for")).toBe(false);
      return jsonResponse(raw);
    });
    const fetcher = new SafeJsonFetcher({
      fetch: transport,
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });

    const result = await fetcher.fetchJson(
      INTEGRATION_ENDPOINT_IDS.sessions,
      buildSessionsUrl("UMNTC", ["1269"]),
    );

    expect(result.json).toEqual({ sessions: [] });
    expect(result.observation).toEqual({
      algorithm: "SHA-256",
      sha256: createHash("sha256").update(raw).digest("hex"),
      byteLength: Buffer.byteLength(raw),
      fetchedAt: "2026-07-22T12:00:00.000Z",
      sourceUrl: buildSessionsUrl("UMNTC", ["1269"]),
      httpStatus: 200,
      contentType: "application/json; charset=UTF-8",
      rawContentPersisted: false,
    });
    expect(result.observation).not.toHaveProperty("body");
    expect(result.observation).not.toHaveProperty("raw");
  });

  it.each([
    "http://sessions.umn.edu/sessions.json?q=institution_id=UMNTC,term_id=1269",
    "https://sessions.umn.edu.evil.example/sessions.json?q=institution_id=UMNTC,term_id=1269",
    "https://sessions.umn.edu@evil.example/sessions.json?q=institution_id=UMNTC,term_id=1269",
    "https://attacker@sessions.umn.edu/sessions.json?q=institution_id=UMNTC,term_id=1269",
    "https://sessions.umn.edu:444/sessions.json?q=institution_id=UMNTC,term_id=1269",
    "https://sessions.umn.edu/sessions.json?q=institution_id=UMNTC,term_id=1269#fragment",
    "https://sessions.umn.edu/sessions.json?q=institution_id=UMNTC,term_id=1269&url=https://evil.example",
    "https://sessions.umn.edu/sessions.json?q=institution_id=UMNTC,term_id=1269&q=institution_id=UMNMO,term_id=1269",
    "https://sessions.umn.edu/sessions.json?q=institution_id=OTHER,term_id=1269",
    "https://sessions.umn.edu/%2fsessions.json?q=institution_id=UMNTC,term_id=1269",
    "https://sessions.umn.edu/sessions.json?q=institution_id=UMNTC",
    "https://sessions.umn.edu/sessions.json?q=institution_id=UMNTC,term_id=1269|1265",
    "https://sessions.umn.edu/sessions.json?q=institution_id=UMNTC,term_id=1269|1269",
    "https://sessions.umn.edu/sessions.json?q=institution_id=UMNTC,term_id=1261|1265|1269|1273",
    "data:application/json,{}",
  ])("rejects malicious or non-allowlisted targets before network: %s", async (url) => {
    const transport = vi.fn(async () => jsonResponse("{}"));
    const fetcher = new SafeJsonFetcher({ fetch: transport });
    await expect(fetcher.fetchJson(INTEGRATION_ENDPOINT_IDS.sessions, url)).rejects.toMatchObject({
      code: "TARGET_NOT_ALLOWED",
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("requires a canonical bounded Sessions term filter", () => {
    expect(buildSessionsUrl("UMNTC", ["1273", "1265", "1269"])).toBe(
      "https://sessions.umn.edu/sessions.json?q=institution_id=UMNTC,term_id=1265|1269|1273",
    );
    expect(() => buildSessionsUrl("UMNTC", [])).toThrow(/1 through 3/u);
    expect(() => buildSessionsUrl("UMNTC", ["1269", "1269"])).toThrow(/unique/u);
    expect(() => buildSessionsUrl("UMNTC", ["fall-2026"])).toThrow(/decimal digits/u);
    expect(() => buildSessionsUrl("UMNTC", ["1261", "1265", "1269", "1273"])).toThrow(/1 through 3/u);
  });

  it("does not permit an approved URL under the wrong endpoint identity", async () => {
    const transport = vi.fn(async () => jsonResponse("{}"));
    const fetcher = new SafeJsonFetcher({ fetch: transport });
    await expect(
      fetcher.fetchJson(INTEGRATION_ENDPOINT_IDS.duluthEvents, buildSessionsUrl("UMNDL", ["1269"])),
    ).rejects.toMatchObject({ code: "TARGET_NOT_ALLOWED" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("enforces the injected timeout even if a transport ignores abort", async () => {
    const transport = vi.fn(() => new Promise<Response>(() => undefined));
    const fetcher = new SafeJsonFetcher({ fetch: transport, timeoutMs: 5 });
    await expect(
      fetcher.fetchJson(INTEGRATION_ENDPOINT_IDS.sessions, buildSessionsUrl("UMNTC", ["1269"])),
    ).rejects.toMatchObject({ code: "TIMEOUT", retryable: true });
  });

  it("applies the same timeout to a stalled response body stream", async () => {
    const body = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => undefined) });
    const fetcher = new SafeJsonFetcher({
      fetch: async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } }),
      timeoutMs: 5,
    });
    await expect(
      fetcher.fetchJson(INTEGRATION_ENDPOINT_IDS.sessions, buildSessionsUrl("UMNTC", ["1269"])),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it.each([
    [302, "UPSTREAM_REDIRECT"],
    [307, "UPSTREAM_REDIRECT"],
    [429, "UPSTREAM_RATE_LIMITED"],
    [500, "UPSTREAM_SERVER_ERROR"],
    [503, "UPSTREAM_SERVER_ERROR"],
  ] as const)("maps upstream status %i without consuming its body", async (status, code) => {
    let bodyAccessed = false;
    const response = {
      status,
      url: "",
      headers: new Headers({ location: "https://evil.example" }),
      get body() {
        bodyAccessed = true;
        throw new Error("body must not be accessed");
      },
    } as unknown as Response;
    const fetcher = new SafeJsonFetcher({
      fetch: async () => response,
    });
    await expect(
      fetcher.fetchJson(INTEGRATION_ENDPOINT_IDS.sessions, buildSessionsUrl("UMNTC", ["1269"])),
    ).rejects.toMatchObject({ code });
    expect(bodyAccessed).toBe(false);
  });

  it("rejects non-JSON content types", async () => {
    const fetcher = new SafeJsonFetcher({
      fetch: async () => new Response("{}", { headers: { "content-type": "text/html" } }),
    });
    await expect(
      fetcher.fetchJson(INTEGRATION_ENDPOINT_IDS.sessions, buildSessionsUrl("UMNTC", ["1269"])),
    ).rejects.toMatchObject({ code: "INVALID_CONTENT_TYPE" });
  });

  it("accepts structured JSON media types", async () => {
    const fetcher = new SafeJsonFetcher({
      fetch: async () => new Response("{}", { headers: { "content-type": "application/feed+json" } }),
    });
    await expect(
      fetcher.fetchJson(INTEGRATION_ENDPOINT_IDS.sessions, buildSessionsUrl("UMNTC", ["1269"])),
    ).resolves.toMatchObject({ json: {} });
  });

  it("rejects an oversized declared content length before reading", async () => {
    let bodyAccessed = false;
    const response = {
      status: 200,
      url: "",
      headers: new Headers({ "content-type": "application/json", "content-length": "6" }),
      get body() {
        bodyAccessed = true;
        throw new Error("body must not be accessed");
      },
    } as unknown as Response;
    const fetcher = new SafeJsonFetcher({
      fetch: async () => response,
      maxBytes: 5,
    });
    await expect(
      fetcher.fetchJson(INTEGRATION_ENDPOINT_IDS.sessions, buildSessionsUrl("UMNTC", ["1269"])),
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
    expect(bodyAccessed).toBe(false);
  });

  it("enforces a hard streaming byte limit when content-length is absent or false", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"a":'));
        controller.enqueue(new TextEncoder().encode("12345}"));
        controller.close();
      },
    });
    const fetcher = new SafeJsonFetcher({
      fetch: async () => new Response(body, { headers: { "content-type": "application/json" } }),
      maxBytes: 8,
    });
    await expect(
      fetcher.fetchJson(INTEGRATION_ENDPOINT_IDS.sessions, buildSessionsUrl("UMNTC", ["1269"])),
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });

  it("does not let a stalled stream cancellation bypass the total timeout", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("oversized"));
      },
      cancel: () => new Promise<void>(() => undefined),
    });
    const fetcher = new SafeJsonFetcher({
      fetch: async () => new Response(body, { headers: { "content-type": "application/json" } }),
      maxBytes: 1,
      timeoutMs: 5,
    });
    await expect(
      fetcher.fetchJson(INTEGRATION_ENDPOINT_IDS.sessions, buildSessionsUrl("UMNTC", ["1269"])),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("rejects malformed JSON without including source bytes in the error", async () => {
    const secret = "not-json-secret";
    const fetcher = new SafeJsonFetcher({ fetch: async () => jsonResponse(secret) });
    const error = await fetcher
      .fetchJson(INTEGRATION_ENDPOINT_IDS.sessions, buildSessionsUrl("UMNTC", ["1269"]))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IntegrationError);
    expect(error).toBeInstanceOf(ObservedIntegrationError);
    expect(error).toMatchObject({ code: "INVALID_JSON" });
    expect(error).toMatchObject({
      observation: {
        byteLength: Buffer.byteLength(secret),
        httpStatus: 200,
        rawContentPersisted: false,
        sha256: createHash("sha256").update(secret).digest("hex"),
      },
    });
    expect(String(error)).not.toContain(secret);
    expect(String(error instanceof Error ? error.cause : undefined)).not.toContain(secret);
    expect(error).not.toHaveProperty("rawBody");
  });

  it("allows only the fixed LiveWhale path and bounded page query", async () => {
    const transport = vi.fn(async () => jsonResponse('{"data":[]}'));
    const fetcher = new SafeJsonFetcher({ fetch: transport });
    await expect(
      fetcher.fetchJson(INTEGRATION_ENDPOINT_IDS.twinCitiesEvents, buildLiveWhaleUrl("tc", 2)),
    ).resolves.toBeDefined();
    await expect(
      fetcher.fetchJson(
        INTEGRATION_ENDPOINT_IDS.twinCitiesEvents,
        "https://events.tc.umn.edu/live/json/events?include_hidden=1",
      ),
    ).rejects.toMatchObject({ code: "TARGET_NOT_ALLOWED" });
    await expect(
      fetcher.fetchJson(
        INTEGRATION_ENDPOINT_IDS.twinCitiesEvents,
        "https://events.tc.umn.edu/live/json/v2/events/response_fields/location,status/paginate/50",
      ),
    ).rejects.toMatchObject({ code: "TARGET_NOT_ALLOWED" });
    expect(() => buildLiveWhaleUrl("tc", 21)).toThrow(/1 through 20/u);
  });
});
