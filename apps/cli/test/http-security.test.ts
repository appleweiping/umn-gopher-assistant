import { describe, expect, it } from "vitest";

import { redactText } from "../src/errors.js";
import { limitResponseBody } from "../src/http.js";

describe("HTTP and diagnostic data limits", () => {
  it("rejects a declared response larger than the configured bound", () => {
    const response = new Response("{}", {
      headers: { "content-length": "100" },
      status: 200,
    });
    expect(() => limitResponseBody(response, 10)).toThrow(
      expect.objectContaining({ code: "response-too-large", exitCode: 7 }),
    );
  });

  it("terminates a chunked body once the stream crosses the bound", async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2]));
          controller.enqueue(new Uint8Array([3, 4]));
          controller.close();
        },
      }),
    );
    await expect(limitResponseBody(response, 3).arrayBuffer()).rejects.toMatchObject({
      code: "response-too-large",
      exitCode: 7,
    });
  });

  it("redacts bearer, JSON, assignment, JWT, and credential-query forms", () => {
    const input =
      'Bearer bearer-secret {"refresh_token":"json-secret"} device_code=assignment-secret ' +
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature123?access_token=query-secret";
    const redacted = redactText(input);
    for (const secret of [
      "bearer-secret",
      "json-secret",
      "assignment-secret",
      "eyJhbGciOiJIUzI1NiJ9",
      "query-secret",
    ]) {
      expect(redacted).not.toContain(secret);
    }
  });
});
