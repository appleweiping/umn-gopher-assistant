import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { ensureRequestId } from "../src/http/request-id.interceptor.js";

describe("request ID resolution", () => {
  it("does not reuse a predictable framework ID when the request header is missing", () => {
    const request = { headers: {}, id: "req-1000" } as FastifyRequest;

    const requestId = ensureRequestId(request);

    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(request.id).toBe(requestId);
    expect(ensureRequestId(request)).toBe(requestId);
  });
});
