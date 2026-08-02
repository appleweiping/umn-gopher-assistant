import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { AiQueryResponseSchema } from "@umn-gopher-assistant/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module.js";
import { createFastifyAdapter } from "../src/http/fastify-adapter.js";

const describeWithStack = process.env["API_AI_STACK_INTEGRATION"] === "true" ? describe : describe.skip;

describeWithStack("public API through Redis and the PostgreSQL-backed knowledge service", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleReference = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleReference.createNestApplication<NestFastifyApplication>(
      createFastifyAdapter({ NODE_ENV: "test" }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns validated evidence and distributed quota metadata across the real service chain", async () => {
    const correlationId = `ai-stack-${randomUUID()}`;
    const response = await request(app.getHttpServer())
      .post("/v1/ai/query")
      .set("X-Request-Id", correlationId)
      .send({ campusId: "tc", locale: "en", query: "library research help" })
      .expect(200);

    const parsed = AiQueryResponseSchema.parse(response.body);
    expect(parsed.campusId).toBe("tc");
    expect(parsed.locale).toBe("en");
    expect(parsed.citations.length).toBeGreaterThan(0);
    expect(parsed.paragraphs.length).toBeGreaterThan(0);
    for (const citation of parsed.citations) {
      expect(citation.summarySource).toMatchObject({
        corpusSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        kind: "project-authored-summary",
      });
      expect(citation.verificationLink).toMatchObject({
        contentRetrieved: false,
        kind: "official-verification-link",
        sourceUse: "verification-link-only",
      });
      expect(citation.verificationLink.sourceUrl).toMatch(/^https:\/\//u);
    }
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["ratelimit-limit"]).toMatch(/^\d+$/u);
    expect(response.headers["ratelimit-remaining"]).toMatch(/^\d+$/u);
    expect(response.headers["ratelimit-reset"]).toMatch(/^\d+$/u);
    expect(response.headers["x-request-id"]).toBe(correlationId);
  });
});
import { randomUUID } from "node:crypto";
