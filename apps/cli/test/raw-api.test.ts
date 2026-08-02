import { decodeJwt } from "jose";
import { describe, expect, it, vi } from "vitest";

import { RawApiClient, type RawMethod } from "../src/raw-api.js";
import { TEST_DPOP_CREDENTIAL } from "./dpop-fixture.js";
import { jsonResponse } from "./helpers.js";

describe("raw read client", () => {
  it("does not resolve or attach a token for a public implemented operation", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (request) => {
      if (!(request instanceof Request)) throw new TypeError("expected a Request");
      expect(request.headers.has("authorization")).toBe(false);
      expect(request.redirect).toBe("error");
      return jsonResponse([], 200, { etag: '"campuses"', "x-request-id": "request-1" });
    });
    const client = new RawApiClient({
      credential: async () => {
        throw new Error("must not resolve auth for a public request");
      },
      baseUrl: new URL("https://api.example/"),
      http: { fetch: fetchMock, timeoutMs: 1000 },
    });
    await expect(client.request("GET", "/v1/campuses")).resolves.toEqual({
      data: [],
      etag: '"campuses"',
      operationId: "listCampuses",
      requestId: "request-1",
      status: 200,
    });
  });

  it("supports HEAD without parsing a response body", async () => {
    const client = new RawApiClient({
      credential: async () => TEST_DPOP_CREDENTIAL,
      baseUrl: new URL("https://api.example/"),
      http: {
        fetch: vi.fn<typeof fetch>(async () => new Response(null, { status: 200 })),
        timeoutMs: 1000,
      },
    });
    await expect(client.request("HEAD", "/v1/worlds/tc/manifest")).resolves.toMatchObject({
      data: null,
      operationId: "getWorldManifest",
      status: 200,
    });
  });

  it.each([{}, [{}]])("rejects a raw GET body outside the generated schema: %j", async (body) => {
    const client = new RawApiClient({
      credential: async () => TEST_DPOP_CREDENTIAL,
      baseUrl: new URL("https://api.example/"),
      http: {
        fetch: vi.fn<typeof fetch>(async () => jsonResponse(body)),
        timeoutMs: 1000,
      },
    });
    await expect(client.request("GET", "/v1/campuses")).rejects.toMatchObject({
      code: "invalid-success-body",
      name: "GopherProtocolError",
      operationId: "listCampuses",
      status: 200,
    });
  });

  it("rejects a successful status not declared by the generated GET operation", async () => {
    const client = new RawApiClient({
      credential: async () => TEST_DPOP_CREDENTIAL,
      baseUrl: new URL("https://api.example/"),
      http: {
        fetch: vi.fn<typeof fetch>(async () => jsonResponse([], 201)),
        timeoutMs: 1000,
      },
    });
    await expect(client.request("GET", "/v1/campuses")).rejects.toMatchObject({
      code: "unexpected-success-status",
      name: "GopherProtocolError",
      operationId: "listCampuses",
      status: 201,
    });
  });

  it("applies the GET operation's declared status set to HEAD", async () => {
    const client = new RawApiClient({
      credential: async () => TEST_DPOP_CREDENTIAL,
      baseUrl: new URL("https://api.example/"),
      http: {
        fetch: vi.fn<typeof fetch>(async () => new Response(null, { status: 204 })),
        timeoutMs: 1000,
      },
    });
    await expect(client.request("HEAD", "/v1/campuses")).rejects.toMatchObject({
      code: "unexpected-success-status",
      name: "GopherProtocolError",
      operationId: "listCampuses",
      status: 204,
    });
  });

  it("rejects a body on a successful HEAD response", async () => {
    const client = new RawApiClient({
      credential: async () => TEST_DPOP_CREDENTIAL,
      baseUrl: new URL("https://api.example/"),
      http: {
        fetch: vi.fn<typeof fetch>(
          async () =>
            new Response("unexpected", {
              headers: { "content-type": "application/json" },
              status: 200,
            }),
        ),
        timeoutMs: 1000,
      },
    });
    await expect(client.request("HEAD", "/v1/campuses")).rejects.toMatchObject({
      code: "invalid-success-body",
      name: "GopherProtocolError",
      operationId: "listCampuses",
      status: 200,
    });
  });

  it("rejects a non-read method supplied by ordinary untyped JavaScript", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new RawApiClient({
      credential: async () => TEST_DPOP_CREDENTIAL,
      baseUrl: new URL("https://api.example/"),
      http: { fetch: fetchMock, timeoutMs: 1000 },
    });
    const unsafeMethod = "POST" as unknown as RawMethod;
    await expect(client.request(unsafeMethod, "/v1/campuses")).rejects.toMatchObject({
      code: "raw-method-forbidden",
      exitCode: 2,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses DPoP for protected raw reads and retries one resource nonce challenge", async () => {
    const proofs: string[] = [];
    let calls = 0;
    const client = new RawApiClient({
      baseUrl: new URL("https://api.example/"),
      credential: async () => TEST_DPOP_CREDENTIAL,
      http: {
        fetch: vi.fn<typeof fetch>(async (request) => {
          calls += 1;
          if (!(request instanceof Request)) throw new TypeError("expected Request");
          expect(request.headers.get("authorization")).toBe(`DPoP ${TEST_DPOP_CREDENTIAL.accessToken}`);
          proofs.push(request.headers.get("dpop") ?? "");
          if (calls === 1) {
            return jsonResponse({ error: "use_dpop_nonce" }, 401, {
              "dpop-nonce": "resource-nonce-001",
              "www-authenticate": 'DPoP realm="api", error="use_dpop_nonce"',
            });
          }
          return jsonResponse(
            {
              detail: "Permission denied.",
              instance: "/v1/personal/vault/bootstrap",
              status: 403,
              title: "Forbidden",
              traceId: "trace-forbidden",
              type: "about:blank",
            },
            403,
          );
        }),
        timeoutMs: 1000,
      },
    });

    await expect(client.request("GET", "/v1/personal/vault/bootstrap")).rejects.toMatchObject({
      code: "permission-denied",
      exitCode: 5,
    });
    expect(proofs).toHaveLength(2);
    expect(decodeJwt(proofs[0] ?? "")["nonce"]).toBeUndefined();
    expect(decodeJwt(proofs[1] ?? "")["nonce"]).toBe("resource-nonce-001");
    expect(decodeJwt(proofs[1] ?? "").jti).not.toBe(decodeJwt(proofs[0] ?? "").jti);
  });
});
