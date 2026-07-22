import { describe, expect, it } from "vitest";

import { CliError } from "../src/errors.js";
import { normalizeApiBaseUrl, resolveRawRequestUrl, validateRawRequestPath } from "../src/url-policy.js";

describe("endpoint and raw request policy", () => {
  it("requires HTTPS except for explicit loopback endpoints", () => {
    expect(normalizeApiBaseUrl("https://api.example/v1-root").toString()).toBe(
      "https://api.example/v1-root/",
    );
    expect(normalizeApiBaseUrl("http://127.0.0.1:3001").toString()).toBe("http://127.0.0.1:3001/");
    expect(() => normalizeApiBaseUrl("http://192.168.1.10:3001")).toThrow(CliError);
    expect(() => normalizeApiBaseUrl("https://user:pass@api.example")).toThrow(CliError);
    expect(() => normalizeApiBaseUrl("https://api.example?token=secret")).toThrow(CliError);
  });

  it.each([
    "https://api.example/v1/campuses",
    "//api.example/v1/campuses",
    "/v1/../admin",
    "/v1/%2e%2e/admin",
    "/v1/worlds%2ftc/manifest",
    "/v1/campuses#fragment",
    "/v1/sources?access_token=secret",
    "/v1/sources?client-secret=secret",
    "/v1/sources?x-api-key=secret",
    "/v1/sources?cookie=session",
    "/v1/sources?auth[token]=secret",
    "/v1/community/posts",
  ])("rejects an unsafe or contract-only raw path: %s", (path) => {
    expect(() => validateRawRequestPath(path)).toThrow(CliError);
  });

  it("matches only paths derived from implemented SDK operations", () => {
    expect(validateRawRequestPath("/v1/campuses").operationId).toBe("listCampuses");
    expect(validateRawRequestPath("/v1/sources?campusId=tc&cursor=next-page&limit=10").operationId).toBe(
      "listSources",
    );
    expect(validateRawRequestPath("/v1/worlds/tc/manifest").operationId).toBe("getWorldManifest");
    expect(validateRawRequestPath("/v1/events?campusId=tc&limit=10").operationId).toBe("listEvents");
    expect(validateRawRequestPath("/v1/academics/sessions?campusId=rochester&limit=10").operationId).toBe(
      "listAcademicSessions",
    );
  });

  it.each([
    ["/v1/sources?unknown=value", "unknown-query-parameter"],
    ["/v1/campuses?limit=10", "unknown-query-parameter"],
    ["/v1/sources?limit=10&limit=20", "duplicate-query-parameter"],
  ])("rejects query data outside the generated operation contract: %s", (path, code) => {
    try {
      validateRawRequestPath(path);
      throw new Error("expected raw query validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect(error).toMatchObject({ code, exitCode: 2 });
    }
  });

  it("keeps an API base path without permitting an origin escape", () => {
    const base = normalizeApiBaseUrl("https://api.example/gopher");
    expect(resolveRawRequestUrl(base, "/v1/campuses").toString()).toBe(
      "https://api.example/gopher/v1/campuses",
    );
  });
});
