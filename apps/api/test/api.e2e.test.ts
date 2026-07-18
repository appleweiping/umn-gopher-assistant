import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { SourceDescriptorSchema } from "@umn-gopher-assistant/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { createFastifyAdapter } from "../src/http/fastify-adapter.js";

interface SourcePageBody {
  readonly items: unknown[];
  readonly nextCursor: string | null;
}

describe("foundation API", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter({}), {
      logger: false,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves health and all five campuses with conditional caching", async () => {
    const health = await app.inject({ method: "GET", url: "/v1/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ok", service: "campus-api" });

    const campuses = await app.inject({ method: "GET", url: "/v1/campuses" });
    expect(campuses.statusCode).toBe(200);
    expect(campuses.json()).toHaveLength(5);
    expect(campuses.headers.etag).toBeTypeOf("string");
    if (typeof campuses.headers.etag !== "string") {
      return;
    }

    const cachedCampuses = await app.inject({
      method: "GET",
      url: "/v1/campuses",
      headers: { "if-none-match": campuses.headers.etag },
    });
    expect(cachedCampuses.statusCode).toBe(304);
  });

  it("filters sources and returns a cursor page with provenance", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/sources?campusId=rochester" });
    expect(response.statusCode).toBe(200);
    const body = response.json<SourcePageBody>();
    expect(body.nextCursor).toBeNull();
    expect(SourceDescriptorSchema.array().parse(body.items)[0]).toMatchObject({
      id: "rochester-campus-home",
      officialStatus: "UNVERIFIED",
      sourceUrl: "https://r.umn.edu/",
    });
  });

  it("paginates sources and honors their ETag", async () => {
    const first = await app.inject({ method: "GET", url: "/v1/sources?limit=2" });
    expect(first.statusCode).toBe(200);
    const firstPage = first.json<SourcePageBody>();
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).toBeTypeOf("string");
    expect(first.headers.etag).toBeTypeOf("string");
    if (typeof firstPage.nextCursor !== "string" || typeof first.headers.etag !== "string") {
      return;
    }

    const second = await app.inject({
      method: "GET",
      url: `/v1/sources?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json<SourcePageBody>().items).toHaveLength(2);

    const cached = await app.inject({
      method: "GET",
      url: "/v1/sources?limit=2",
      headers: { "if-none-match": first.headers.etag },
    });
    expect(cached.statusCode).toBe(304);
  });

  it("rejects invalid source pagination parameters with problem details", async () => {
    const invalidLimit = await app.inject({ method: "GET", url: "/v1/sources?limit=0" });
    expect(invalidLimit.statusCode).toBe(400);
    expect(invalidLimit.headers["content-type"]).toContain("application/problem+json");

    const invalidCursor = await app.inject({ method: "GET", url: "/v1/sources?cursor=not-a-cursor" });
    expect(invalidCursor.statusCode).toBe(400);
  });

  it("returns ETags and honors If-None-Match for world manifests", async () => {
    const first = await app.inject({ method: "GET", url: "/v1/worlds/tc/manifest" });
    expect(first.statusCode).toBe(200);
    const etag = first.headers.etag;
    expect(etag).toBe('"tc-schematic-v1-r1"');
    if (typeof etag !== "string") {
      throw new TypeError("Expected a string ETag header");
    }

    const cached = await app.inject({
      method: "GET",
      url: "/v1/worlds/tc/manifest",
      headers: { "if-none-match": etag },
    });
    expect(cached.statusCode).toBe(304);
  });

  it("returns RFC 9457 problems for unknown campuses", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/worlds/unknown/manifest" });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).toContain("application/problem+json");
    expect(response.json()).toMatchObject({ status: 404, title: "Not Found" });
  });

  it("uses weak If-None-Match comparison for lists, wildcard, and multiple tags", async () => {
    for (const url of ["/v1/campuses", "/v1/sources?limit=2", "/v1/worlds/tc/manifest"]) {
      const original = await app.inject({ method: "GET", url });
      const etag = original.headers.etag;
      expect(original.statusCode).toBe(200);
      if (typeof etag !== "string") {
        throw new TypeError(`Expected ${url} to return an ETag`);
      }

      for (const ifNoneMatch of [`W/${etag}`, `"unrelated", W/${etag}`, "*"]) {
        const cached = await app.inject({ method: "GET", url, headers: { "if-none-match": ifNoneMatch } });
        expect(cached.statusCode, `${url} with ${ifNoneMatch}`).toBe(304);
      }

      const changed = await app.inject({
        method: "GET",
        url,
        headers: { "if-none-match": 'W/"unrelated"' },
      });
      expect(changed.statusCode).toBe(200);
    }
  });

  it("echoes a reusable request ID on successful responses", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/health",
      headers: { "x-request-id": "request-e2e-123" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-request-id"]).toBe("request-e2e-123");
  });

  it("replaces missing or out-of-contract request IDs with unpredictable compliant values", async () => {
    const missingOne = await app.inject({ method: "GET", url: "/v1/health" });
    const missingTwo = await app.inject({ method: "GET", url: "/v1/health" });
    const tooShort = await app.inject({
      method: "GET",
      url: "/v1/health",
      headers: { "x-request-id": "short" },
    });
    const tooLongValue = "x".repeat(129);
    const tooLong = await app.inject({
      method: "GET",
      url: "/v1/health",
      headers: { "x-request-id": tooLongValue },
    });
    const generated = [missingOne, missingTwo, tooShort, tooLong].map((response) => {
      const requestId = response.headers["x-request-id"];
      expect(requestId).toBeTypeOf("string");
      if (typeof requestId !== "string") {
        throw new TypeError("Expected a string X-Request-Id response header");
      }
      return requestId;
    });

    for (const requestId of generated) {
      expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
      expect(requestId.length).toBeGreaterThanOrEqual(8);
      expect(requestId.length).toBeLessThanOrEqual(128);
    }
    expect(new Set(generated).size).toBe(generated.length);
    expect(generated).not.toContain("short");
    expect(generated).not.toContain(tooLongValue);
  });
});
