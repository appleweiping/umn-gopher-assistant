import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { SourceDescriptorSchema } from "@umn-gopher-assistant/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";

describe("foundation API", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves health and all five campuses", async () => {
    const health = await app.inject({ method: "GET", url: "/v1/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ok", service: "campus-api" });

    const campuses = await app.inject({ method: "GET", url: "/v1/campuses" });
    expect(campuses.statusCode).toBe(200);
    expect(campuses.json()).toHaveLength(5);
  });

  it("filters sources and preserves provenance", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/sources?campusId=rochester" });
    expect(response.statusCode).toBe(200);
    const body = SourceDescriptorSchema.array().parse(response.json());
    expect(body[0]).toMatchObject({
      id: "rochester-campus-home",
      officialStatus: "UNVERIFIED",
      sourceUrl: "https://r.umn.edu/",
    });
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
});
