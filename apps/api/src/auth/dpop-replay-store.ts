import { createHash, randomBytes } from "node:crypto";
import { channel } from "node:diagnostics_channel";

import type { OnModuleDestroy } from "@nestjs/common";
import { createClient } from "redis";

import { DpopReplayStoreUnavailableException } from "./bearer-auth.errors.js";
import { isBoundedJwtString } from "./jwt-string.js";

const BASE64URL_256 = /^[A-Za-z0-9_-]{43}$/u;
const NONCE = /^[\x21\x23-\x5B\x5D-\x7E]{1,512}$/u;
const MAX_IN_MEMORY_ENTRIES = 100_000;
const operationalEvents = channel("umn-gopher-assistant.auth.dpop-replay");

const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[3])
if count == 1 then
  redis.call('EXPIRE', KEYS[3], ARGV[6])
end
local rate_ttl = redis.call('TTL', KEYS[3])
if count > tonumber(ARGV[5]) then
  return {2, tostring(math.max(rate_ttl, 1))}
end
local current = redis.call('GET', KEYS[1])
if redis.call('EXISTS', KEYS[2]) == 1 then
  return {-1, current or ''}
end
local claimed = redis.call('SET', KEYS[2], '1', 'NX', 'EX', ARGV[4])
if not claimed then
  return {-1, current or ''}
end
if not current then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  return {0, ARGV[2]}
end
if ARGV[1] == '' then
  return {0, current}
end
if ARGV[1] ~= current then
  return {0, current}
end
redis.call('EXPIRE', KEYS[1], ARGV[3])
return {1, current}
`;

export type DpopReplayDecision =
  | { readonly status: "accepted" }
  | { readonly nonce: string; readonly status: "challenge" }
  | { readonly status: "replay" }
  | { readonly retryAfterSeconds: number; readonly status: "rate_limited" };

export interface DpopReplayStore {
  consume(
    subject: string,
    jkt: string,
    jti: string,
    presentedNonce: string | undefined,
  ): Promise<DpopReplayDecision>;
}

interface ReplayRedisClient {
  readonly isOpen: boolean;
  readonly isReady: boolean;
  close(): Promise<unknown>;
  connect(): Promise<unknown>;
  destroy?(): unknown;
  eval(script: string, options: { readonly arguments: string[]; readonly keys: string[] }): Promise<unknown>;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export interface RedisDpopReplayStoreOptions {
  readonly client?: ReplayRedisClient;
  readonly nonceTtlSeconds: number;
  readonly operationTimeoutMs: number;
  readonly proofLimit: number;
  readonly proofWindowSeconds: number;
  readonly redisUrl: URL;
  readonly replayTtlSeconds: number;
}

function boundedInteger(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${String(maximum)}`);
  }
  return value;
}

function digest(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("base64url");
}

function keys(subject: string, jkt: string, jti: string): readonly [string, string, string] {
  const partition = digest([subject]);
  const slot = `uga:auth:{dpop:${partition}}`;
  return [`${slot}:nonce:${digest([jkt])}`, `${slot}:proof:${digest([jkt, jti])}`, `${slot}:rate`];
}

export function dpopReplayKeysForTesting(
  subject: string,
  jkt: string,
  jti: string,
): readonly [string, string, string] {
  validateInput(subject, jkt, jti, undefined);
  return keys(subject, jkt, jti);
}

function validateInput(subject: string, jkt: string, jti: string, nonce: string | undefined): void {
  if (
    subject.length < 1 ||
    subject.length > 512 ||
    !BASE64URL_256.test(jkt) ||
    Buffer.from(jkt, "base64url").toString("base64url") !== jkt ||
    !isBoundedJwtString(jti, 256) ||
    (nonce !== undefined && !NONCE.test(nonce))
  ) {
    throw new TypeError("DPoP replay-store input is invalid");
  }
}

function freshNonce(): string {
  return randomBytes(32).toString("base64url");
}

function beforeDeadline<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("DPoP replay-store operation timed out")),
      milliseconds,
    );
    timeout.unref();
    operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error("DPoP replay-store operation failed"));
      },
    );
  });
}

function parseDecision(value: unknown): DpopReplayDecision {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    (value[0] !== -1 && value[0] !== 0 && value[0] !== 1 && value[0] !== 2) ||
    typeof value[1] !== "string"
  ) {
    throw new TypeError("Redis returned an invalid DPoP replay decision");
  }
  if (value[0] === 2) {
    const retryAfterSeconds = Number(value[1]);
    if (!Number.isSafeInteger(retryAfterSeconds) || retryAfterSeconds < 1 || retryAfterSeconds > 3_600) {
      throw new TypeError("Redis returned an invalid DPoP replay decision");
    }
    return { retryAfterSeconds, status: "rate_limited" };
  }
  if (value[0] !== -1 && !NONCE.test(value[1])) {
    throw new TypeError("Redis returned an invalid DPoP replay decision");
  }
  if (value[0] === 1) return { status: "accepted" };
  if (value[0] === -1) return { status: "replay" };
  return { nonce: value[1], status: "challenge" };
}

export class RedisDpopReplayStore implements DpopReplayStore, OnModuleDestroy {
  readonly #client: ReplayRedisClient;
  readonly #nonceTtlSeconds: number;
  readonly #operationTimeoutMs: number;
  readonly #proofLimit: number;
  readonly #proofWindowSeconds: number;
  readonly #replayTtlSeconds: number;
  #connecting: Promise<unknown> | undefined;

  constructor(options: RedisDpopReplayStoreOptions) {
    this.#nonceTtlSeconds = boundedInteger(options.nonceTtlSeconds, "nonceTtlSeconds", 900);
    this.#operationTimeoutMs = boundedInteger(options.operationTimeoutMs, "operationTimeoutMs", 10_000);
    this.#proofLimit = boundedInteger(options.proofLimit, "proofLimit", 100_000);
    this.#proofWindowSeconds = boundedInteger(options.proofWindowSeconds, "proofWindowSeconds", 3_600);
    this.#replayTtlSeconds = boundedInteger(options.replayTtlSeconds, "replayTtlSeconds", 900);
    this.#client =
      options.client ??
      createClient({
        commandOptions: { timeout: this.#operationTimeoutMs },
        commandsQueueMaxLength: 100,
        disableOfflineQueue: true,
        socket: { connectTimeout: this.#operationTimeoutMs, reconnectStrategy: false },
        url: options.redisUrl.href,
      });
    this.#client.on("error", () => operationalEvents.publish({ code: "DPOP_REDIS_CLIENT_ERROR" }));
  }

  async #connect(): Promise<void> {
    if (this.#client.isReady) return;
    if (this.#connecting === undefined) {
      if (this.#client.isOpen) this.#client.destroy?.();
      this.#connecting = this.#client.connect().finally(() => {
        this.#connecting = undefined;
      });
    }
    await beforeDeadline(this.#connecting, this.#operationTimeoutMs);
  }

  async consume(
    subject: string,
    jkt: string,
    jti: string,
    presentedNonce: string | undefined,
  ): Promise<DpopReplayDecision> {
    validateInput(subject, jkt, jti, presentedNonce);
    const [nonceKey, replayKey, rateKey] = keys(subject, jkt, jti);
    try {
      await this.#connect();
      return parseDecision(
        await beforeDeadline(
          this.#client.eval(CONSUME_SCRIPT, {
            arguments: [
              presentedNonce ?? "",
              freshNonce(),
              String(this.#nonceTtlSeconds),
              String(this.#replayTtlSeconds),
              String(this.#proofLimit),
              String(this.#proofWindowSeconds),
            ],
            keys: [nonceKey, replayKey, rateKey],
          }),
          this.#operationTimeoutMs,
        ),
      );
    } catch (error) {
      if (error instanceof TypeError && error.message === "DPoP replay-store input is invalid") {
        throw error;
      }
      this.#client.destroy?.();
      operationalEvents.publish({ code: "DPOP_REPLAY_STORE_UNAVAILABLE" });
      throw new DpopReplayStoreUnavailableException();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.#client.isOpen) return;
    if (this.#client.destroy !== undefined) {
      this.#client.destroy();
      return;
    }
    await beforeDeadline(this.#client.close(), this.#operationTimeoutMs).catch(() => undefined);
  }
}

/**
 * Explicit deterministic-process test harness. Production wiring always uses
 * Redis so replay state is shared across replicas and fails closed on outage.
 */
export class InMemoryDpopReplayStore implements DpopReplayStore {
  readonly #nonces = new Map<string, { readonly expiresAt: number; readonly value: string }>();
  readonly #proofs = new Map<string, number>();
  readonly #rates = new Map<string, { count: number; readonly resetAt: number }>();

  constructor(
    private readonly nonceTtlMilliseconds = 300_000,
    private readonly replayTtlMilliseconds = 120_000,
    private readonly now: () => number = Date.now,
    private readonly proofLimit = 600,
    private readonly proofWindowMilliseconds = 60_000,
  ) {}

  consume(
    subject: string,
    jkt: string,
    jti: string,
    presentedNonce: string | undefined,
  ): Promise<DpopReplayDecision> {
    validateInput(subject, jkt, jti, presentedNonce);
    const now = this.now();
    for (const [key, expiry] of this.#proofs) if (expiry <= now) this.#proofs.delete(key);
    for (const [key, nonce] of this.#nonces) if (nonce.expiresAt <= now) this.#nonces.delete(key);
    for (const [key, rate] of this.#rates) if (rate.resetAt <= now) this.#rates.delete(key);
    const subjectKey = digest([subject]);
    const rate = this.#rates.get(subjectKey);
    const nextRate =
      rate === undefined
        ? { count: 1, resetAt: now + this.proofWindowMilliseconds }
        : { count: rate.count + 1, resetAt: rate.resetAt };
    this.#rates.set(subjectKey, nextRate);
    if (nextRate.count > this.proofLimit) {
      return Promise.resolve({
        retryAfterSeconds: Math.max(1, Math.ceil((nextRate.resetAt - now) / 1_000)),
        status: "rate_limited",
      });
    }
    const nonceKey = digest([subject, jkt]);
    const proofKey = digest([subject, jkt, jti]);
    if (this.#proofs.has(proofKey)) return Promise.resolve({ status: "replay" });
    if (this.#proofs.size >= MAX_IN_MEMORY_ENTRIES) {
      const oldest = this.#proofs.keys().next().value;
      if (oldest !== undefined) this.#proofs.delete(oldest);
    }
    // Claim every syntactically and cryptographically valid proof before
    // evaluating its nonce. A challenged proof must never be reusable to
    // manipulate challenge state.
    this.#proofs.set(proofKey, now + this.replayTtlMilliseconds);
    let current = this.#nonces.get(nonceKey)?.value;
    if (current === undefined) {
      current = freshNonce();
      this.#nonces.set(nonceKey, { expiresAt: now + this.nonceTtlMilliseconds, value: current });
      return Promise.resolve({ nonce: current, status: "challenge" });
    }
    if (presentedNonce === undefined) {
      return Promise.resolve({ nonce: current, status: "challenge" });
    }
    if (presentedNonce !== current) {
      return Promise.resolve({ nonce: current, status: "challenge" });
    }
    this.#nonces.set(nonceKey, { expiresAt: now + this.nonceTtlMilliseconds, value: current });
    return Promise.resolve({ status: "accepted" });
  }
}
