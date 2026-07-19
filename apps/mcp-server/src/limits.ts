import { isIP } from "node:net";

export interface RateLimitCharge {
  readonly key: string;
  readonly limit: number;
}

export type RateLimitDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

interface WindowEntry {
  count: number;
  readonly resetAt: number;
}

export class ConcurrencyGate {
  readonly #limit: number;
  #active = 0;

  constructor(limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new TypeError("Concurrency limit must be a positive safe integer");
    }
    this.#limit = limit;
  }

  get active(): number {
    return this.#active;
  }

  tryAcquire(): (() => void) | undefined {
    if (this.#active >= this.#limit) return undefined;
    this.#active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
    };
  }
}

export class BoundedFixedWindowRateLimiter {
  readonly #entries = new Map<string, WindowEntry>();
  readonly #maxEntries: number;
  readonly #now: () => number;
  readonly #windowMs: number;
  #nextSweepAt = 0;

  constructor(options: {
    readonly maxEntries: number;
    readonly now?: () => number;
    readonly windowMs: number;
  }) {
    if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries < 1) {
      throw new TypeError("Rate-limit maximum entries must be a positive safe integer");
    }
    if (!Number.isSafeInteger(options.windowMs) || options.windowMs < 1) {
      throw new TypeError("Rate-limit window must be a positive safe integer");
    }
    this.#maxEntries = options.maxEntries;
    this.#now = options.now ?? Date.now;
    this.#windowMs = options.windowMs;
  }

  get size(): number {
    return this.#entries.size;
  }

  consume(charges: readonly RateLimitCharge[]): RateLimitDecision {
    if (charges.length === 0) return { allowed: true };
    const now = Math.floor(this.#now());
    if (!Number.isSafeInteger(now) || now < 0) {
      return { allowed: false, retryAfterSeconds: 1 };
    }
    if (now >= this.#nextSweepAt) this.#pruneExpired(now);

    const seen = new Set<string>();
    for (const charge of charges) {
      if (
        charge.key.length === 0 ||
        charge.key.length > 1_024 ||
        !Number.isSafeInteger(charge.limit) ||
        charge.limit < 1 ||
        seen.has(charge.key)
      ) {
        return { allowed: false, retryAfterSeconds: 1 };
      }
      seen.add(charge.key);
      const entry = this.#entries.get(charge.key);
      if (entry !== undefined && entry.resetAt > now && entry.count >= charge.limit) {
        return { allowed: false, retryAfterSeconds: retryAfterSeconds(entry.resetAt, now) };
      }
    }

    let requiredEntries = 0;
    for (const charge of charges) {
      const entry = this.#entries.get(charge.key);
      if (entry === undefined || entry.resetAt <= now) requiredEntries += 1;
    }
    if (this.#entries.size + requiredEntries > this.#maxEntries) {
      this.#pruneExpired(now);
      requiredEntries = 0;
      for (const charge of charges) {
        if (!this.#entries.has(charge.key)) requiredEntries += 1;
      }
      if (this.#entries.size + requiredEntries > this.#maxEntries) {
        const earliestReset = Math.min(...[...this.#entries.values()].map((entry) => entry.resetAt));
        return {
          allowed: false,
          retryAfterSeconds: Number.isFinite(earliestReset) ? retryAfterSeconds(earliestReset, now) : 1,
        };
      }
    }

    for (const charge of charges) {
      const entry = this.#entries.get(charge.key);
      if (entry === undefined || entry.resetAt <= now) {
        this.#entries.set(charge.key, { count: 1, resetAt: now + this.#windowMs });
      } else {
        entry.count += 1;
      }
    }
    return { allowed: true };
  }

  #pruneExpired(now: number): void {
    for (const [key, entry] of this.#entries) {
      if (entry.resetAt <= now) this.#entries.delete(key);
    }
    this.#nextSweepAt = now + this.#windowMs;
  }
}

function retryAfterSeconds(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1_000));
}

export function normalizeIpAddress(value: string): string | undefined {
  const mappedIpv4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(value)?.[1];
  if (mappedIpv4 !== undefined && isIP(mappedIpv4) === 4) return mappedIpv4;
  const version = isIP(value);
  if (version === 4) return value;
  if (version === 6) {
    const hostname = new URL(`http://[${value}]/`).hostname;
    return hostname.slice(1, -1).toLowerCase();
  }
  return undefined;
}

export function resolveClientAddress(
  remoteAddress: string | undefined,
  forwardedFor: string | undefined,
  trustedProxyIps: ReadonlySet<string>,
): string {
  const peer = remoteAddress === undefined ? "unknown" : (normalizeIpAddress(remoteAddress) ?? "unknown");
  if (forwardedFor === undefined || !trustedProxyIps.has(peer)) return peer;
  if (forwardedFor.length === 0 || forwardedFor.length > 2_048) {
    throw new TypeError("Invalid forwarded client address chain");
  }

  const rawChain = forwardedFor.split(",");
  if (rawChain.length > 16) throw new TypeError("Forwarded client address chain is too long");
  const seen = new Set<string>();
  const chain = rawChain.map((raw) => {
    if (raw.trim() !== raw && raw.trim().length === 0) {
      throw new TypeError("Invalid forwarded client address chain");
    }
    const address = normalizeIpAddress(raw.trim());
    if (address === undefined) throw new TypeError("Invalid forwarded client address chain");
    if (seen.has(address)) throw new TypeError("Duplicate forwarded client address");
    seen.add(address);
    return address;
  });

  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const address = chain[index];
    if (address !== undefined && !trustedProxyIps.has(address)) return address;
  }
  return chain[0] ?? peer;
}
