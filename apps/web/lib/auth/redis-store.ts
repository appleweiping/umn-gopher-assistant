import { createHash } from "node:crypto";

import { createClient } from "redis";

import type { WebAuthRuntime } from "./runtime";

// v2 intentionally invalidates pre-fencing sessions from the v1 key layout.
const KEY_PREFIX = "gopher:web-auth:v2";
const MAX_RECORD_LENGTH = 192 * 1_024;
const OPAQUE_ID = /^[A-Za-z0-9_-]{43}$/u;
const DPOP_NONCE = /^[\x21\x23-\x5B\x5D-\x7E]{1,512}$/u;

export interface AuthSessionStore {
  acquireRefreshLock(id: string, token: string, ttlMilliseconds: number): Promise<boolean>;
  consumeTransaction(id: string, sealed: string): Promise<boolean>;
  deleteSession(id: string): Promise<void>;
  deleteSessionIfCurrent(id: string, expectedSealed: string): Promise<boolean>;
  getResourceDpopNonce(id: string): Promise<string | undefined>;
  getSession(id: string): Promise<string | undefined>;
  getTransaction(id: string): Promise<string | undefined>;
  putSession(id: string, sealed: string, ttlSeconds: number): Promise<void>;
  putResourceDpopNonce(id: string, nonce: string, ttlSeconds: number): Promise<void>;
  putTransaction(id: string, sealed: string, ttlSeconds: number): Promise<void>;
  replaceSessionIfCurrent(
    id: string,
    expectedSealed: string,
    replacementSealed: string,
    ttlSeconds: number,
  ): Promise<boolean>;
  releaseRefreshLock(id: string, token: string): Promise<void>;
}

function createAuthRedisClient(runtime: WebAuthRuntime) {
  return createClient({
    commandOptions: { timeout: 3_000 },
    commandsQueueMaxLength: 100,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 3_000,
      reconnectStrategy(retries: number) {
        return retries < 3 ? Math.min(100 * 2 ** retries, 1_000) : new Error("Redis unavailable");
      },
    },
    url: runtime.redisUrl,
  });
}

type RedisAuthClient = ReturnType<typeof createAuthRedisClient>;

function checkedOpaqueId(id: string): string {
  if (!OPAQUE_ID.test(id) || Buffer.from(id, "base64url").toString("base64url") !== id) {
    throw new TypeError("Web-auth store ID is invalid");
  }
  return id;
}

function sessionSlot(id: string): string {
  const digest = createHash("sha256").update(checkedOpaqueId(id), "ascii").digest("base64url");
  return `${KEY_PREFIX}:{${digest}}`;
}

function sessionKey(id: string): string {
  return `${sessionSlot(id)}:session`;
}

function transactionKey(id: string): string {
  return `${KEY_PREFIX}:transaction:${checkedOpaqueId(id)}`;
}

function checkedLockToken(token: string): string {
  if (!OPAQUE_ID.test(token) || Buffer.from(token, "base64url").toString("base64url") !== token) {
    throw new TypeError("Web-auth refresh-lock token is invalid");
  }
  return token;
}

function checkedRecord(value: string): string {
  if (value.length < 16 || value.length > MAX_RECORD_LENGTH) {
    throw new TypeError("Web-auth record length is invalid");
  }
  return value;
}

function checkedTtl(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 8 * 60 * 60) {
    throw new TypeError("Web-auth record TTL is invalid");
  }
  return value;
}

function dpopNonceKey(id: string): string {
  return `${sessionSlot(id)}:resource-dpop-nonce`;
}

function refreshLockKey(id: string): string {
  return `${sessionSlot(id)}:refresh-lock`;
}

export function sessionStoreKeysForTesting(id: string): readonly string[] {
  return [sessionKey(id), dpopNonceKey(id), refreshLockKey(id)];
}

function checkedDpopNonce(value: string): string {
  if (!DPOP_NONCE.test(value)) throw new TypeError("Resource-server DPoP nonce is invalid");
  return value;
}

export class RedisAuthSessionStore implements AuthSessionStore {
  readonly #client: RedisAuthClient;

  constructor(client: RedisAuthClient) {
    this.#client = client;
  }

  async acquireRefreshLock(id: string, token: string, ttlMilliseconds: number): Promise<boolean> {
    if (!Number.isSafeInteger(ttlMilliseconds) || ttlMilliseconds < 1_000 || ttlMilliseconds > 60_000) {
      throw new TypeError("Web-auth refresh-lock TTL is invalid");
    }
    return (
      (await this.#client.set(refreshLockKey(id), checkedLockToken(token), {
        NX: true,
        PX: ttlMilliseconds,
      })) === "OK"
    );
  }

  async deleteSession(id: string): Promise<void> {
    await this.#client.del([sessionKey(id), dpopNonceKey(id), refreshLockKey(id)]);
  }

  async deleteSessionIfCurrent(id: string, expectedSealed: string): Promise<boolean> {
    return (
      (await this.#client.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1], KEYS[2]); return 1 else return 0 end",
        {
          arguments: [checkedRecord(expectedSealed)],
          keys: [sessionKey(id), dpopNonceKey(id)],
        },
      )) === 1
    );
  }

  async consumeTransaction(id: string, sealed: string): Promise<boolean> {
    return (
      (await this.#client.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]); return 1 else return 0 end",
        { arguments: [checkedRecord(sealed)], keys: [transactionKey(id)] },
      )) === 1
    );
  }

  async getSession(id: string): Promise<string | undefined> {
    return (await this.#client.get(sessionKey(id))) ?? undefined;
  }

  async getResourceDpopNonce(id: string): Promise<string | undefined> {
    const nonce = await this.#client.get(dpopNonceKey(id));
    return nonce === null ? undefined : checkedDpopNonce(nonce);
  }

  async getTransaction(id: string): Promise<string | undefined> {
    return (await this.#client.get(transactionKey(id))) ?? undefined;
  }

  async putSession(id: string, sealed: string, ttlSeconds: number): Promise<void> {
    await this.#client.set(sessionKey(id), checkedRecord(sealed), { EX: checkedTtl(ttlSeconds) });
  }

  async putResourceDpopNonce(id: string, nonce: string, ttlSeconds: number): Promise<void> {
    await this.#client.set(dpopNonceKey(id), checkedDpopNonce(nonce), {
      EX: checkedTtl(ttlSeconds),
    });
  }

  async putTransaction(id: string, sealed: string, ttlSeconds: number): Promise<void> {
    const stored = await this.#client.set(transactionKey(id), checkedRecord(sealed), {
      EX: checkedTtl(ttlSeconds),
      NX: true,
    });
    if (stored !== "OK") throw new Error("A web-auth transaction ID collision occurred");
  }

  async replaceSessionIfCurrent(
    id: string,
    expectedSealed: string,
    replacementSealed: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    return (
      (await this.#client.eval(
        "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3]); return 1 else return 0 end",
        {
          arguments: [
            checkedRecord(expectedSealed),
            checkedRecord(replacementSealed),
            String(checkedTtl(ttlSeconds)),
          ],
          keys: [sessionKey(id)],
        },
      )) === 1
    );
  }

  async releaseRefreshLock(id: string, token: string): Promise<void> {
    await this.#client.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
      { arguments: [checkedLockToken(token)], keys: [refreshLockKey(id)] },
    );
  }
}

let sharedStore: Promise<AuthSessionStore> | undefined;

export function webAuthSessionStore(runtime: WebAuthRuntime): Promise<AuthSessionStore> {
  sharedStore ??= (async () => {
    const client = createAuthRedisClient(runtime);
    // A listener is mandatory in node-redis; intentionally do not log payloads
    // or connection URLs from this security-sensitive store.
    client.on("error", () => undefined);
    await client.connect();
    return new RedisAuthSessionStore(client);
  })().catch((error: unknown) => {
    // A transient Redis outage must fail this request closed without poisoning
    // the process-wide singleton after the backing service has recovered.
    sharedStore = undefined;
    throw error;
  });
  return sharedStore;
}
