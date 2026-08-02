import { createHash } from "node:crypto";
import { channel } from "node:diagnostics_channel";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { createClient } from "redis";

import { loadApiRuntimeConfig } from "../runtime-config.js";

const MAX_MEMORY_NONCES = 100_000;
const OPERATION_TIMEOUT_MS = 1_000;
const operationalEvents = channel("umn-gopher-assistant.personal.read-proof-replay");

interface ReplayRedisClient {
  readonly isOpen: boolean;
  readonly isReady: boolean;
  close(): Promise<unknown>;
  connect(): Promise<unknown>;
  destroy?(): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  set(key: string, value: string, options: { readonly NX: true; readonly PX: number }): Promise<unknown>;
}

function beforeDeadline<T>(operation: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Read-proof replay store operation timed out")),
      OPERATION_TIMEOUT_MS,
    );
    timeout.unref();
    operation.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error("Replay store operation failed"));
      },
    );
  });
}

function explicitReplayRedisUrl(): URL | null {
  const explicit = process.env["API_PERSONAL_REPLAY_REDIS_URL"];
  if (explicit === undefined) {
    return process.env["NODE_ENV"] === "production" ? loadApiRuntimeConfig().ai.rateLimit.redisUrl : null;
  }
  let url: URL;
  try {
    url = new URL(explicit);
  } catch {
    throw new TypeError("API_PERSONAL_REPLAY_REDIS_URL must be an absolute Redis URL");
  }
  if (
    (url.protocol !== "redis:" && url.protocol !== "rediss:") ||
    url.password.length === 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new TypeError(
      "API_PERSONAL_REPLAY_REDIS_URL must use redis or rediss, contain a password, and omit query and fragment",
    );
  }
  if (process.env["NODE_ENV"] === "production" && url.protocol !== "rediss:") {
    throw new TypeError("API_PERSONAL_REPLAY_REDIS_URL must use rediss in production");
  }
  return url;
}

function replayKey(ownerBinding: string, signerKeyId: string, nonce: string): string {
  const digest = createHash("sha256")
    .update(ownerBinding)
    .update("\0")
    .update(signerKeyId)
    .update("\0")
    .update(nonce)
    .digest("base64url");
  return `uga:personal:{read-proof}:nonce:${digest}`;
}

@Injectable()
export class ReadProofReplayGuard implements OnModuleDestroy {
  readonly #memory = new Map<string, number>();
  readonly #redis: ReplayRedisClient | null;
  #connecting: Promise<unknown> | undefined;

  constructor() {
    const url = explicitReplayRedisUrl();
    this.#redis =
      url === null
        ? null
        : createClient({
            commandOptions: { timeout: OPERATION_TIMEOUT_MS },
            commandsQueueMaxLength: 100,
            disableOfflineQueue: true,
            socket: { connectTimeout: OPERATION_TIMEOUT_MS, reconnectStrategy: false },
            url: url.href,
          });
    this.#redis?.on("error", () => {
      operationalEvents.publish({ code: "PERSONAL_READ_REPLAY_REDIS_ERROR" });
    });
  }

  async #connect(): Promise<void> {
    if (this.#redis === null || this.#redis.isReady) return;
    if (this.#connecting === undefined) {
      if (this.#redis.isOpen) this.#redis.destroy?.();
      this.#connecting = this.#redis.connect().finally(() => {
        this.#connecting = undefined;
      });
    }
    await beforeDeadline(this.#connecting);
  }

  #consumeInMemory(key: string, expiresAt: number, now: number): boolean {
    for (const [candidate, expiry] of this.#memory) {
      if (expiry <= now) this.#memory.delete(candidate);
    }
    const previousExpiry = this.#memory.get(key);
    if (previousExpiry !== undefined && previousExpiry > now) return false;
    if (this.#memory.size >= MAX_MEMORY_NONCES) {
      const oldest = this.#memory.keys().next().value;
      if (oldest !== undefined) this.#memory.delete(oldest);
    }
    this.#memory.set(key, expiresAt);
    return true;
  }

  async consume(
    ownerBinding: string,
    signerKeyId: string,
    nonce: string,
    expiresAt: string,
    now = new Date(),
  ): Promise<boolean> {
    const expiry = Date.parse(expiresAt);
    const ttl = Math.max(1, expiry - now.getTime());
    const key = replayKey(ownerBinding, signerKeyId, nonce);
    if (this.#redis === null) {
      return this.#consumeInMemory(key, expiry, now.getTime());
    }
    try {
      await this.#connect();
      return (await beforeDeadline(this.#redis.set(key, "1", { NX: true, PX: ttl }))) === "OK";
    } catch {
      this.#redis.destroy?.();
      operationalEvents.publish({ code: "PERSONAL_READ_REPLAY_STORE_UNAVAILABLE" });
      throw new Error("Read-proof replay protection is unavailable");
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.#redis === null || !this.#redis.isOpen) return;
    if (this.#redis.destroy !== undefined) {
      this.#redis.destroy();
      return;
    }
    await beforeDeadline(this.#redis.close()).catch(() => undefined);
  }
}
