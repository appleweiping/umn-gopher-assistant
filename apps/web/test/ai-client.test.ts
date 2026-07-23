// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { AiQueryRequestError, queryCampusIndex } from "../lib/ai/client";
import { aiResponse } from "./ai-fixtures";

afterEach(() => vi.restoreAllMocks());

describe("AI browser client", () => {
  it("posts a no-store same-origin request and returns only a strict response", async () => {
    const browserFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(aiResponse()));
    const response = await queryCampusIndex(
      { campusId: "tc", locale: "en", query: "When is the library open?" },
      new AbortController().signal,
    );

    expect(response.state).toBe("answered");
    const [url, init] = browserFetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/ai/query");
    expect(init).toMatchObject({
      cache: "no-store",
      credentials: "omit",
      method: "POST",
      redirect: "error",
    });
    expect(JSON.parse(init?.body as string)).toEqual({
      campusId: "tc",
      locale: "en",
      query: "When is the library open?",
    });
  });

  it.each([
    { label: "unknown fields", body: { ...aiResponse(), unknown: true } },
    {
      label: "cross-campus evidence",
      body: {
        ...aiResponse(),
        citations: [{ ...aiResponse().citations[0], campusId: "morris" }],
      },
    },
    { label: "uncited paragraphs", body: { ...aiResponse(), citations: [] } },
  ])("fails closed for $label", async ({ body }) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(body));
    await expect(
      queryCampusIndex(
        { campusId: "tc", locale: "en", query: "When is the library open?" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ failureCode: "AI_CONTRACT_MISMATCH", status: 502 });
  });

  it("never exposes a server detail or stack through its error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        {
          detail: "database password is hunter2",
          failureCode: "AI_SERVICE_UNAVAILABLE",
          stack: "internal.ts:42",
        },
        { status: 503 },
      ),
    );

    let observed: unknown;
    try {
      await queryCampusIndex(
        { campusId: "tc", locale: "en", query: "When is the library open?" },
        new AbortController().signal,
      );
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(AiQueryRequestError);
    expect(observed).toMatchObject({ failureCode: "AI_SERVICE_UNAVAILABLE", status: 503 });
    expect(String(observed)).not.toContain("hunter2");
    expect(String(observed)).not.toContain("internal.ts");
  });

  it("rejects malformed input before making a request", async () => {
    const browserFetch = vi.spyOn(globalThis, "fetch");
    await expect(
      queryCampusIndex({ campusId: "tc", locale: "en", query: " " }, new AbortController().signal),
    ).rejects.toMatchObject({ failureCode: "INVALID_AI_QUERY", status: 400 });
    expect(browserFetch).not.toHaveBeenCalled();
  });
});
