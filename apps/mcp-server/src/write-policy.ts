import { randomUUID, timingSafeEqual } from "node:crypto";

export type FutureWriteState = "confirmed" | "consumed" | "expired" | "previewed";

export interface FutureWritePreview {
  readonly expiresAt: number;
  readonly idempotencyKey: string;
  readonly operationId: string;
  readonly payloadSha256: string;
  readonly previewId: string;
  readonly state: "previewed";
}

export interface FutureWriteConfirmation {
  readonly explicitConfirmation: boolean;
  readonly idempotencyKey: string;
  readonly payloadSha256: string;
  readonly previewId: string;
}

type StoredPreview = Omit<FutureWritePreview, "state"> & { state: FutureWriteState };

const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{16,128}$/u;
const sha256Pattern = /^[a-f0-9]{64}$/u;

/**
 * Unwired policy scaffold for future write tools. It is deliberately not
 * registered with MCP and does not execute an API operation.
 */
export class FutureWriteConfirmationMachine {
  readonly #previews = new Map<string, StoredPreview>();
  readonly #ttlMs: number;

  constructor(ttlMs = 5 * 60_000) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 15 * 60_000) {
      throw new TypeError("Write preview TTL must be between one and fifteen minutes");
    }
    this.#ttlMs = ttlMs;
  }

  createPreview(
    input: { readonly idempotencyKey: string; readonly operationId: string; readonly payloadSha256: string },
    now = Date.now(),
  ): FutureWritePreview {
    if (!idempotencyKeyPattern.test(input.idempotencyKey)) {
      throw new TypeError("A valid idempotency key is required before previewing a write");
    }
    if (!sha256Pattern.test(input.payloadSha256)) {
      throw new TypeError("A lowercase SHA-256 payload digest is required before previewing a write");
    }
    if (!/^[A-Za-z][A-Za-z0-9]{2,127}$/u.test(input.operationId)) {
      throw new TypeError("A stable operation ID is required before previewing a write");
    }
    const preview: StoredPreview = {
      expiresAt: now + this.#ttlMs,
      idempotencyKey: input.idempotencyKey,
      operationId: input.operationId,
      payloadSha256: input.payloadSha256,
      previewId: randomUUID(),
      state: "previewed",
    };
    this.#previews.set(preview.previewId, preview);
    return { ...preview, state: "previewed" };
  }

  confirm(
    input: FutureWriteConfirmation,
    now = Date.now(),
  ): {
    readonly idempotencyKey: string;
    readonly operationId: string;
    readonly previewId: string;
    readonly state: "confirmed";
  } {
    if (!input.explicitConfirmation) {
      throw new Error("Write confirmation must be explicit");
    }
    const preview = this.#previews.get(input.previewId);
    if (preview?.state !== "previewed") {
      throw new Error("Write preview is missing or no longer confirmable");
    }
    if (now >= preview.expiresAt) {
      preview.state = "expired";
      throw new Error("Write preview has expired");
    }
    if (
      !safeEqual(preview.idempotencyKey, input.idempotencyKey) ||
      !safeEqual(preview.payloadSha256, input.payloadSha256)
    ) {
      throw new Error("Write confirmation does not match its preview");
    }
    preview.state = "confirmed";
    return {
      idempotencyKey: preview.idempotencyKey,
      operationId: preview.operationId,
      previewId: preview.previewId,
      state: "confirmed",
    };
  }

  consume(previewId: string): void {
    const preview = this.#previews.get(previewId);
    if (preview?.state !== "confirmed") throw new Error("Write preview is not confirmed");
    preview.state = "consumed";
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
