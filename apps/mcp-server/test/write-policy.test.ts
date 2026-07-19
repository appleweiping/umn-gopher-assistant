import { describe, expect, it } from "vitest";

import { FutureWriteConfirmationMachine } from "../src/write-policy.js";

describe("future MCP write confirmation policy", () => {
  const idempotencyKey = "future-write-key-0001";
  const payloadSha256 = "a".repeat(64);

  it("requires a matching preview, explicit confirmation, and single consumption", () => {
    const machine = new FutureWriteConfirmationMachine(5_000);
    const preview = machine.createPreview(
      { idempotencyKey, operationId: "createCommunityPost", payloadSha256 },
      1_000,
    );

    expect(() =>
      machine.confirm(
        {
          explicitConfirmation: false,
          idempotencyKey,
          payloadSha256,
          previewId: preview.previewId,
        },
        1_500,
      ),
    ).toThrow(/explicit/u);

    const confirmed = machine.confirm(
      {
        explicitConfirmation: true,
        idempotencyKey,
        payloadSha256,
        previewId: preview.previewId,
      },
      2_000,
    );
    expect(confirmed.state).toBe("confirmed");
    machine.consume(preview.previewId);
    expect(() => machine.consume(preview.previewId)).toThrow(/not confirmed/u);
  });

  it("rejects payload substitution, idempotency substitution, and expiry", () => {
    const machine = new FutureWriteConfirmationMachine(1_000);
    const preview = machine.createPreview(
      { idempotencyKey, operationId: "createCommunityPost", payloadSha256 },
      1_000,
    );

    expect(() =>
      machine.confirm(
        {
          explicitConfirmation: true,
          idempotencyKey,
          payloadSha256: "b".repeat(64),
          previewId: preview.previewId,
        },
        1_500,
      ),
    ).toThrow(/does not match/u);
    expect(() =>
      machine.confirm(
        {
          explicitConfirmation: true,
          idempotencyKey: "different-key-000001",
          payloadSha256,
          previewId: preview.previewId,
        },
        1_500,
      ),
    ).toThrow(/does not match/u);
    expect(() =>
      machine.confirm(
        {
          explicitConfirmation: true,
          idempotencyKey,
          payloadSha256,
          previewId: preview.previewId,
        },
        2_000,
      ),
    ).toThrow(/expired/u);
  });
});
