import { describe, expect, it, vi } from "vitest";

import { GopherApiError, GopherClient, GopherProtocolError } from "../src/index.js";

const baseUrl = "https://assistant.example.test/base/";

function response(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    headers,
    status: init.status ?? 200,
  });
}

describe("GopherClient", () => {
  it("requires HTTPS except for explicit loopback development hosts", () => {
    expect(() => new GopherClient({ baseUrl: "http://api.example.test" })).toThrow(/must use HTTPS/u);
    expect(() => new GopherClient({ baseUrl: "http://127.0.0.1:3000" })).not.toThrow();
    expect(() => new GopherClient({ baseUrl: "http://[::1]:3000" })).not.toThrow();
  });

  it("calls a generated operation with typed query values", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ items: [], nextCursor: null }, { headers: { etag: '"events-v1"' } }));
    const client = new GopherClient({ baseUrl, fetch: fetchMock });

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
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ campusId: "tc" }));
    const client = new GopherClient({ baseUrl, fetch: fetchMock });

    await client.request("getWorldManifest", {
      path: { campusId: "tc/../morris" as "tc" },
    });

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.url).toBe("https://assistant.example.test/base/v1/worlds/tc%2F..%2Fmorris/manifest");
  });

  it("resolves a token for each request without exposing it", async () => {
    const tokenProvider = vi.fn().mockResolvedValue("private-access-token");
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => response([]));
    const client = new GopherClient({ baseUrl, accessToken: tokenProvider, fetch: fetchMock });

    await client.request("listAcademicCourses", { query: { campusId: "rochester" } });

    expect(tokenProvider).toHaveBeenCalledOnce();
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.headers.get("authorization")).toBe("Bearer private-access-token");
    expect(JSON.stringify(await client.request("listAcademicCourses"))).not.toContain("private-access-token");
  });

  it("does not resolve or attach a token for an explicitly public operation", async () => {
    const tokenProvider = vi.fn().mockResolvedValue("must-stay-private");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ status: "ok" }));
    const client = new GopherClient({ baseUrl, accessToken: tokenProvider, fetch: fetchMock });

    await client.request("getHealth");

    expect(tokenProvider).not.toHaveBeenCalled();
    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.headers.has("authorization")).toBe(false);
  });

  it("sends conditional, idempotency, and request correlation headers", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ routeId: "route-1" }));
    const client = new GopherClient({ baseUrl, fetch: fetchMock });

    await client.request("calculateRoute", {
      body: {
        campusId: "tc",
        destination: [-93.23, 44.98],
        origin: [-93.24, 44.97],
        profile: "walking",
      },
      etag: 'W/"route-input-v1"',
      idempotencyKey: "26cf2094-bfdf-4e98-aef5-03c51574bf37",
      requestId: "request-123",
    });

    const [request] = fetchMock.mock.calls[0] as [Request];
    expect(request.headers.get("if-none-match")).toBe('W/"route-input-v1"');
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

  it("returns an explicit result for a 304 response", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(undefined, { headers: { etag: '"campuses-v1"' }, status: 304 }));
    const client = new GopherClient({ baseUrl, fetch: fetchMock });

    await expect(client.request("listCampuses", { etag: '"campuses-v1"' })).resolves.toEqual({
      etag: '"campuses-v1"',
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
      accessToken: "must-not-escape",
      baseUrl,
      fetch: fetchMock,
    });

    const error = await client.request("listEvents").catch((value: unknown) => value);

    expect(error).toBeInstanceOf(GopherApiError);
    expect(error).toMatchObject({
      problem: { status: 400, traceId: "trace-400" },
      requestId: "request-400",
      status: 400,
    });
    expect(JSON.stringify(error)).not.toContain("must-not-escape");
    expect(String(error)).not.toContain("must-not-escape");
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
    const client = new GopherClient({ baseUrl, fetch: fetchMock });

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
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response({ status: "ok" }));
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
