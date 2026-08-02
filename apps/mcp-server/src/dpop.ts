import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { channel } from "node:diagnostics_channel";

import { calculateJwkThumbprint, decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";
import { createClient } from "redis";

import { canonicalizeDpopHtu } from "@umn-gopher-assistant/sdk";

import type { VerifiedAccessIdentity } from "./auth.js";
import type { McpServerConfig } from "./config.js";

const NONCE = /^[\x21\x23-\x5B\x5D-\x7E]{1,512}$/u;
const BASE64URL_256 = /^[A-Za-z0-9_-]{43}$/u;
const COMPACT_JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const MAX_PROOF_BYTES = 16_384;
const OPERATION_TIMEOUT_MILLISECONDS = 1_000;
const operationalEvents = channel("umn-gopher-assistant.mcp.dpop");
const SCRIPT = `
local current = redis.call('GET', KEYS[1])
if redis.call('EXISTS', KEYS[2]) == 1 then return {-1, current or ''} end
local claimed = redis.call('SET', KEYS[2], '1', 'NX', 'EX', ARGV[4])
if not claimed then return {-1, current or ''} end
if not current then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  return {0, ARGV[2]}
end
if ARGV[1] == '' or ARGV[1] ~= current then return {0, current} end
redis.call('EXPIRE', KEYS[1], ARGV[3])
return {1, current}
`;

export type DpopFailureKind = "invalid" | "nonce" | "unavailable";

export class DpopVerificationError extends Error {
  constructor(
    readonly kind: DpopFailureKind,
    readonly nonce?: string,
  ) {
    super("DPoP verification failed");
    this.name = "DpopVerificationError";
  }
}

export interface DpopProofVerifier {
  close?(): Promise<void>;
  ready?(): Promise<boolean>;
  verify(input: {
    readonly accessToken: string;
    readonly identity: VerifiedAccessIdentity;
    readonly method: string;
    readonly proof: string;
  }): Promise<void>;
}

function digest(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("base64url");
}

function equal(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function hasAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}

function validJti(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.isWellFormed() &&
    !hasAsciiControl(value) &&
    new TextEncoder().encode(value).byteLength <= 256
  );
}

function publicJwk(value: unknown): JWK {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DpopVerificationError("invalid");
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate["kty"] !== "EC" ||
    candidate["crv"] !== "P-256" ||
    typeof candidate["x"] !== "string" ||
    typeof candidate["y"] !== "string" ||
    !BASE64URL_256.test(candidate["x"]) ||
    !BASE64URL_256.test(candidate["y"]) ||
    Buffer.from(candidate["x"], "base64url").toString("base64url") !== candidate["x"] ||
    Buffer.from(candidate["y"], "base64url").toString("base64url") !== candidate["y"] ||
    "d" in candidate
  ) {
    throw new DpopVerificationError("invalid");
  }
  return { crv: "P-256", kty: "EC", x: candidate["x"], y: candidate["y"] };
}

function beforeDeadline<T>(operation: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("DPoP Redis operation timed out")),
      OPERATION_TIMEOUT_MILLISECONDS,
    );
    timeout.unref();
    operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error("DPoP Redis operation failed"));
      },
    );
  });
}

export class RedisDpopProofVerifier implements DpopProofVerifier {
  readonly #client;
  #connecting: Promise<unknown> | undefined;

  constructor(private readonly config: McpServerConfig) {
    if (config.auth.mode !== "oauth") throw new TypeError("DPoP requires OAuth mode");
    this.#client = createClient({
      commandOptions: { timeout: OPERATION_TIMEOUT_MILLISECONDS },
      commandsQueueMaxLength: 100,
      disableOfflineQueue: true,
      socket: {
        connectTimeout: OPERATION_TIMEOUT_MILLISECONDS,
        reconnectStrategy: false,
      },
      url: config.auth.dpopRedisUrl.toString(),
    });
    this.#client.on("error", () => undefined);
  }

  async #connect(): Promise<void> {
    if (this.#client.isReady) return;
    if (this.#connecting === undefined) {
      if (this.#client.isOpen) this.#client.destroy();
      this.#connecting = this.#client.connect().finally(() => {
        this.#connecting = undefined;
      });
    }
    await beforeDeadline(this.#connecting);
  }

  async verify(input: {
    readonly accessToken: string;
    readonly identity: VerifiedAccessIdentity;
    readonly method: string;
    readonly proof: string;
  }): Promise<void> {
    let redisAttempted = false;
    try {
      if (Buffer.byteLength(input.proof, "utf8") > MAX_PROOF_BYTES || !COMPACT_JWT.test(input.proof)) {
        throw new DpopVerificationError("invalid");
      }
      const header = decodeProtectedHeader(input.proof);
      if (
        header.alg !== "ES256" ||
        header.typ !== "dpop+jwt" ||
        header.b64 !== undefined ||
        header.crit !== undefined ||
        header.jku !== undefined ||
        header.x5c !== undefined ||
        header.x5u !== undefined
      ) {
        throw new DpopVerificationError("invalid");
      }
      const jwk = publicJwk(header.jwk);
      const { payload } = await jwtVerify(input.proof, await importJWK(jwk, "ES256"), {
        algorithms: ["ES256"],
        requiredClaims: ["ath", "htm", "htu", "iat", "jti"],
        typ: "dpop+jwt",
      });
      const now = Math.floor(Date.now() / 1_000);
      if (
        payload["htm"] !== input.method ||
        payload["htu"] !== canonicalizeDpopHtu(this.config.resourceUrl) ||
        typeof payload.iat !== "number" ||
        !Number.isSafeInteger(payload.iat) ||
        payload.iat > now + 5 ||
        now - payload.iat > 60 ||
        !validJti(payload.jti) ||
        typeof payload["ath"] !== "string" ||
        !equal(payload["ath"], createHash("sha256").update(input.accessToken, "ascii").digest("base64url")) ||
        (payload["nonce"] !== undefined &&
          (typeof payload["nonce"] !== "string" || !NONCE.test(payload["nonce"])))
      ) {
        throw new DpopVerificationError("invalid");
      }
      const jkt = await calculateJwkThumbprint(jwk, "sha256");
      if (!equal(jkt, input.identity.dpopJkt)) throw new DpopVerificationError("invalid");
      const subjectDigest = digest([input.identity.subject]);
      const slot = `uga:mcp:{dpop:${subjectDigest}}`;
      redisAttempted = true;
      await this.#connect();
      const decision = await beforeDeadline(
        this.#client.eval(SCRIPT, {
          arguments: [
            typeof payload["nonce"] === "string" ? payload["nonce"] : "",
            randomBytes(32).toString("base64url"),
            "300",
            "120",
          ],
          keys: [`${slot}:nonce:${digest([jkt])}`, `${slot}:proof:${digest([jkt, payload.jti])}`],
        }),
      );
      if (!Array.isArray(decision) || decision.length !== 2) {
        throw new DpopVerificationError("unavailable");
      }
      if (decision[0] === 1) return;
      if (decision[0] === -1) throw new DpopVerificationError("invalid");
      if (decision[0] === 0 && typeof decision[1] === "string" && NONCE.test(decision[1])) {
        throw new DpopVerificationError("nonce", decision[1]);
      }
      throw new DpopVerificationError("unavailable");
    } catch (error) {
      if (error instanceof DpopVerificationError) throw error;
      if (redisAttempted) {
        if (this.#client.isOpen) this.#client.destroy();
        operationalEvents.publish({ code: "dpop_replay_store_unavailable" });
        throw new DpopVerificationError("unavailable");
      }
      throw new DpopVerificationError("invalid");
    }
  }

  async ready(): Promise<boolean> {
    try {
      await this.#connect();
      return (await beforeDeadline(this.#client.ping())) === "PONG";
    } catch {
      if (this.#client.isOpen) this.#client.destroy();
      operationalEvents.publish({ code: "dpop_replay_store_readiness_failed" });
      return false;
    }
  }

  close(): Promise<void> {
    if (this.#client.isOpen) this.#client.destroy();
    return Promise.resolve();
  }
}
