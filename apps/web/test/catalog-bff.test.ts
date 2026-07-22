// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { handleCatalogProxy, internalApiBaseUrl } from "../lib/catalog/bff";

const signedCursor = `${"a".repeat(24)}.${"b".repeat(43)}`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("catalog same-origin proxy", () => {
  it("allows only the fixed query surface and omits credentials and redirects", async () => {
    vi.stubEnv("GOPHER_API_BASE_URL", "https://catalog.internal.example");
    const upstreamBody = JSON.stringify({ items: [], marker: "synthetic" });
    const upstreamFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(upstreamBody, {
        headers: { "content-type": "application/json", etag: '"catalog-1"' },
        status: 200,
      }),
    );

    const response = await handleCatalogProxy(
      new Request(
        "https://assistant.example/api/catalog/events?campusId=tc&from=2026-07-22&to=2026-11-19&limit=50",
      ),
      "events",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("etag")).toBe('"catalog-1"');
    expect(await response.text()).toBe(upstreamBody);
    expect(upstreamFetch).toHaveBeenCalledOnce();
    const [url, init] = upstreamFetch.mock.calls[0] ?? [];
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).href).toBe(
      "https://catalog.internal.example/v1/events?campusId=tc&from=2026-07-22&limit=50&to=2026-11-19",
    );
    expect(init).toMatchObject({ cache: "no-store", credentials: "omit", redirect: "error" });
    expect((init?.headers as Headers).has("authorization")).toBe(false);
  });

  it("preserves RFC 9457 failures and only safe response headers", async () => {
    vi.stubEnv("GOPHER_API_BASE_URL", "https://catalog.internal.example");
    const problem = {
      detail: "The campus source is unavailable.",
      failureCode: "TIMEOUT",
      officialUrl: "https://events.tc.umn.edu/",
      status: 503,
      title: "Service Unavailable",
      traceId: "trace-123",
      type: "https://api.example/problems/service-unavailable",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(problem, {
        headers: {
          "retry-after": "60",
          "set-cookie": "must-not-pass=1",
          "x-request-id": "trace-123",
        },
        status: 503,
      }),
    );

    const response = await handleCatalogProxy(
      new Request("https://assistant.example/api/catalog/events?campusId=tc"),
      "events",
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(problem);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("x-request-id")).toBe("trace-123");
    expect(response.headers.has("set-cookie")).toBe(false);
  });

  it("returns a no-store 502 instead of forwarding malformed upstream JSON", async () => {
    vi.stubEnv("GOPHER_API_BASE_URL", "https://catalog.internal.example");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not-json", { headers: { "content-type": "application/json" }, status: 200 }),
    );

    const response = await handleCatalogProxy(
      new Request("https://assistant.example/api/catalog/sessions?campusId=morris"),
      "sessions",
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ failureCode: "INVALID_UPSTREAM_RESPONSE", status: 502 });
  });

  it("rejects unknown, duplicate, and over-wide queries before fetching", async () => {
    const upstreamFetch = vi.spyOn(globalThis, "fetch");
    for (const query of [
      "campusId=tc&target=https://evil.example",
      "campusId=tc&campusId=duluth",
      "campusId=tc&from=2026-01-01&to=2026-12-31",
      "campusId=unknown",
    ]) {
      const response = await handleCatalogProxy(
        new Request(`https://assistant.example/api/catalog/events?${query}`),
        "events",
      );
      expect(response.status).toBe(400);
    }
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("forwards only syntactically safe validators and handles an empty 304", async () => {
    vi.stubEnv("GOPHER_API_BASE_URL", "https://catalog.internal.example");
    const upstreamFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { headers: { etag: 'W/"catalog-2"' }, status: 304 }));
    const response = await handleCatalogProxy(
      new Request("https://assistant.example/api/catalog/events?campusId=tc", {
        headers: { "if-none-match": 'W/"catalog-2"' },
      }),
      "events",
    );

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
    expect(response.headers.get("etag")).toBe('W/"catalog-2"');
    const init = upstreamFetch.mock.calls[0]?.[1];
    expect((init?.headers as Headers).get("if-none-match")).toBe('W/"catalog-2"');
  });

  it.each([
    { headers: {}, label: "an unconditional request" },
    { headers: { "if-none-match": 'W/"catalog-2"' }, label: "a response without a safe ETag" },
  ])("rejects an invalid upstream 304 for $label", async ({ headers }) => {
    vi.stubEnv("GOPHER_API_BASE_URL", "https://catalog.internal.example");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 304 }));

    const response = await handleCatalogProxy(
      new Request("https://assistant.example/api/catalog/events?campusId=tc", { headers }),
      "events",
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      failureCode: "INVALID_UPSTREAM_RESPONSE",
      status: 502,
    });
  });

  it("forwards the exact HMAC-signed cursor shape and rejects unsigned cursors", async () => {
    vi.stubEnv("GOPHER_API_BASE_URL", "https://catalog.internal.example");
    const upstreamFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ items: [], marker: "continuation" }));
    const accepted = await handleCatalogProxy(
      new Request(`https://assistant.example/api/catalog/events?campusId=tc&cursor=${signedCursor}`),
      "events",
    );
    expect(accepted.status).toBe(200);
    expect((upstreamFetch.mock.calls[0]?.[0] as URL).searchParams.get("cursor")).toBe(signedCursor);

    const rejected = await handleCatalogProxy(
      new Request("https://assistant.example/api/catalog/events?campusId=tc&cursor=unsigned"),
      "events",
    );
    expect(rejected.status).toBe(400);
    expect(upstreamFetch).toHaveBeenCalledOnce();
  });

  it("fails closed for an insecure production API base", () => {
    expect(() =>
      internalApiBaseUrl({ NODE_ENV: "production", GOPHER_API_BASE_URL: "http://api.example" }),
    ).toThrow(/HTTPS/u);
    expect(() => internalApiBaseUrl({ NODE_ENV: "test", GOPHER_API_BASE_URL: "http://api.example" })).toThrow(
      /loopback/u,
    );
    expect(internalApiBaseUrl({ NODE_ENV: "test" }).href).toBe("http://127.0.0.1:4000/");
  });
});
