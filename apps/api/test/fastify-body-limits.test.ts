import { Body, Controller, Post } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DEFAULT_BODY_LIMIT,
  PERSONAL_VAULT_MUTATION_BODY_LIMIT,
  createFastifyAdapter,
} from "../src/http/fastify-adapter.js";

@Controller()
class BodyLimitProbeController {
  @Post("v1/personal/vault")
  personal(@Body() body: { readonly data?: unknown }): { readonly received: boolean } {
    return { received: typeof body.data === "string" };
  }

  @Post("v1/ai/query")
  ai(): { readonly reached: true } {
    return { reached: true };
  }

  @Post("test/default-body-limit")
  ordinary(): { readonly reached: true } {
    return { reached: true };
  }
}

let app: NestFastifyApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [BodyLimitProbeController],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter({ NODE_ENV: "test" }), {
    logger: false,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

function jsonPayload(characterCount: number): string {
  return JSON.stringify({ data: "x".repeat(characterCount) });
}

describe("path-bounded request bodies", () => {
  it("lets a multi-megabyte encrypted-vault envelope reach only a personal mutation controller", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/personal/vault",
      headers: { "content-type": "application/json" },
      payload: jsonPayload(DEFAULT_BODY_LIMIT + 64 * 1_024),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ received: true });
  });

  it("rejects personal vault mutations above the 16 MiB wire limit", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/personal/vault",
      headers: { "content-type": "application/json" },
      payload: jsonPayload(PERSONAL_VAULT_MUTATION_BODY_LIMIT + 1),
    });
    expect(response.statusCode).toBe(413);
  });

  it("retains the 8 KiB AI limit and 1 MiB default for unrelated routes", async () => {
    const ai = await app.inject({
      method: "POST",
      url: "/v1/ai/query",
      headers: { "content-type": "application/json" },
      payload: jsonPayload(8_192),
    });
    expect(ai.statusCode).toBe(413);

    const ordinary = await app.inject({
      method: "POST",
      url: "/test/default-body-limit",
      headers: { "content-type": "application/json" },
      payload: jsonPayload(DEFAULT_BODY_LIMIT + 1),
    });
    expect(ordinary.statusCode).toBe(413);
  });
});
