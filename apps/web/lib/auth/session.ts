import { timingSafeEqual } from "node:crypto";

import { authorizationRedirect, exchangeAuthorizationCode, refreshAuthSession } from "./oidc";
import type { OidcDependencies } from "./oidc";
import type { AuthSessionStore } from "./redis-store";
import type { WebAuthRuntime } from "./runtime";
import {
  AUTH_SESSION_COOKIE,
  AUTH_TRANSACTION_COOKIE,
  AUTH_TRANSACTION_TTL_SECONDS,
  clearSessionCookie,
  clearTransactionCookie,
  isSafeReturnTo,
  openAuthRecord,
  randomOpaqueId,
  sealAuthRecord,
  sessionCookie,
  signedAuthCookie,
  transactionCookie,
  uniqueCookieValue,
  verifySignedAuthCookie,
  type AuthRandomness,
  type AuthSessionRecord,
  type AuthTransactionRecord,
} from "./session-records";
import { generateDpopPrivateJwk } from "./dpop";
import type { DpopPrivateJwk } from "./dpop";

const REFRESH_EARLY_SECONDS = 30;
// A token request can perform two nonce-bound attempts at eight seconds each.
// The lease covers that bounded operation with headroom; the CAS write below is
// the fencing mechanism if a process pauses beyond the lease.
const REFRESH_LOCK_MILLISECONDS = 30_000;

export interface AuthFlowDependencies extends AuthRandomness, OidcDependencies {
  readonly delay?: (milliseconds: number) => Promise<void>;
  readonly dpopPrivateJwk?: () => Promise<DpopPrivateJwk>;
}

export interface LoginStartResult {
  readonly location: URL;
  readonly setCookie: string;
}

export interface LoginCompletionResult {
  readonly clearTransactionCookie: string;
  readonly location: URL;
  readonly setSessionCookie: string;
}

export type AuthSessionResolution =
  | {
      readonly authenticated: false;
      readonly clearCookie: string | undefined;
    }
  | {
      readonly authenticated: true;
      readonly record: AuthSessionRecord;
      readonly sessionId: string;
      readonly setCookie: string | undefined;
    };

export class WebAuthFlowError extends Error {
  constructor() {
    super("Web authentication failed");
    this.name = "WebAuthFlowError";
  }
}

function nowSeconds(dependencies: AuthFlowDependencies): number {
  const milliseconds = dependencies.now?.() ?? Date.now();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new WebAuthFlowError();
  return Math.floor(milliseconds / 1_000);
}

function publicRequestOriginMatches(request: Request, runtime: WebAuthRuntime): boolean {
  try {
    return new URL(request.url).origin === runtime.publicOrigin.origin;
  } catch {
    return false;
  }
}

function constantTimeStateMatches(left: string, right: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(left) || !/^[A-Za-z0-9_-]{43}$/u.test(right)) return false;
  const leftBytes = Buffer.from(left, "base64url");
  const rightBytes = Buffer.from(right, "base64url");
  return (
    leftBytes.byteLength === 32 && rightBytes.byteLength === 32 && timingSafeEqual(leftBytes, rightBytes)
  );
}

function checkedReturnTo(value: string | null): string {
  const candidate = value ?? "/plan";
  if (!isSafeReturnTo(candidate) || candidate.startsWith("/auth/")) throw new WebAuthFlowError();
  return candidate;
}

function uniqueQueryParameter(url: URL, name: string): string | undefined {
  const values = url.searchParams.getAll(name);
  return values.length === 1 ? values[0] : undefined;
}

export function requireSameOriginMutation(request: Request, runtime: WebAuthRuntime): void {
  if (
    !publicRequestOriginMatches(request, runtime) ||
    request.headers.get("origin") !== runtime.publicOrigin.origin ||
    request.headers.get("sec-fetch-site") !== "same-origin"
  ) {
    throw new WebAuthFlowError();
  }
}

export async function startLogin(
  request: Request,
  runtime: WebAuthRuntime,
  store: AuthSessionStore,
  dependencies: AuthFlowDependencies = {},
): Promise<LoginStartResult> {
  if (!publicRequestOriginMatches(request, runtime)) throw new WebAuthFlowError();
  const requestUrl = new URL(request.url);
  if (
    [...requestUrl.searchParams.keys()].some((key) => key !== "returnTo") ||
    requestUrl.searchParams.getAll("returnTo").length > 1
  ) {
    throw new WebAuthFlowError();
  }
  const transactionId = randomOpaqueId(dependencies);
  const transaction: AuthTransactionRecord = {
    codeVerifier: randomOpaqueId(dependencies),
    createdAt: nowSeconds(dependencies),
    dpopPrivateJwk: await (dependencies.dpopPrivateJwk ?? generateDpopPrivateJwk)(),
    nonce: randomOpaqueId(dependencies),
    returnTo: checkedReturnTo(requestUrl.searchParams.get("returnTo")),
    state: randomOpaqueId(dependencies),
  };
  const sealed = sealAuthRecord("transaction", transactionId, transaction, runtime, dependencies);
  await store.putTransaction(transactionId, sealed, AUTH_TRANSACTION_TTL_SECONDS);
  return {
    location: await authorizationRedirect(transaction, runtime),
    setCookie: transactionCookie(transactionId, runtime),
  };
}

export async function completeLogin(
  request: Request,
  runtime: WebAuthRuntime,
  store: AuthSessionStore,
  dependencies: AuthFlowDependencies = {},
): Promise<LoginCompletionResult> {
  if (!publicRequestOriginMatches(request, runtime)) throw new WebAuthFlowError();
  const requestUrl = new URL(request.url);
  if (
    [...requestUrl.searchParams.keys()].some((key) => !["code", "state", "session_state"].includes(key)) ||
    requestUrl.searchParams.getAll("session_state").length > 1
  ) {
    throw new WebAuthFlowError();
  }
  const transactionId = verifySignedAuthCookie(
    "transaction",
    uniqueCookieValue(request, AUTH_TRANSACTION_COOKIE),
    runtime,
  );
  if (transactionId === undefined) throw new WebAuthFlowError();
  const sealed = await store.getTransaction(transactionId);
  if (sealed === undefined) throw new WebAuthFlowError();
  const transaction = openAuthRecord("transaction", transactionId, sealed, runtime);
  const now = nowSeconds(dependencies);
  const state = uniqueQueryParameter(requestUrl, "state");
  const code = uniqueQueryParameter(requestUrl, "code");
  if (
    transaction === undefined ||
    transaction.createdAt > now + 5 ||
    now - transaction.createdAt > AUTH_TRANSACTION_TTL_SECONDS ||
    state === undefined ||
    !constantTimeStateMatches(state, transaction.state) ||
    code === undefined
  ) {
    throw new WebAuthFlowError();
  }
  // Compare-and-delete only after the state and bounded transaction record
  // have authenticated. A cross-site callback with a guessed state therefore
  // cannot consume a legitimate in-progress login, while exactly one valid
  // callback can proceed across all Web replicas.
  if (!(await store.consumeTransaction(transactionId, sealed))) {
    throw new WebAuthFlowError();
  }
  const validated = await exchangeAuthorizationCode(code, transaction, runtime, dependencies);
  const sessionId = randomOpaqueId(dependencies);
  await store.putSession(
    sessionId,
    sealAuthRecord("session", sessionId, validated.record, runtime, dependencies),
    validated.ttlSeconds,
  );
  return {
    clearTransactionCookie: clearTransactionCookie(runtime),
    location: new URL(transaction.returnTo, runtime.publicOrigin),
    setSessionCookie: sessionCookie(sessionId, validated.ttlSeconds, runtime),
  };
}

interface LoadedSession {
  readonly record: AuthSessionRecord | undefined;
  readonly sealed: string;
}

async function loadSession(
  sessionId: string,
  runtime: WebAuthRuntime,
  store: AuthSessionStore,
): Promise<LoadedSession | undefined> {
  const sealed = await store.getSession(sessionId);
  return sealed === undefined
    ? undefined
    : { record: openAuthRecord("session", sessionId, sealed, runtime), sealed };
}

async function defaultDelay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function resolveAuthSession(
  request: Request,
  runtime: WebAuthRuntime,
  store: AuthSessionStore,
  dependencies: AuthFlowDependencies = {},
): Promise<AuthSessionResolution> {
  if (!publicRequestOriginMatches(request, runtime)) {
    return { authenticated: false, clearCookie: undefined };
  }
  const sessionId = verifySignedAuthCookie(
    "session",
    uniqueCookieValue(request, AUTH_SESSION_COOKIE),
    runtime,
  );
  if (sessionId === undefined) return { authenticated: false, clearCookie: undefined };
  let loaded = await loadSession(sessionId, runtime, store);
  const now = nowSeconds(dependencies);
  if (
    loaded?.record === undefined ||
    loaded.record.issuer !== runtime.issuer ||
    loaded.record.createdAt > now + 5
  ) {
    if (loaded !== undefined) {
      await store.deleteSessionIfCurrent(sessionId, loaded.sealed);
    }
    return { authenticated: false, clearCookie: clearSessionCookie(runtime) };
  }
  let record: AuthSessionRecord | undefined = loaded.record;
  if (
    record.accessTokenExpiresAt <= now &&
    (record.refreshToken === null ||
      record.refreshTokenExpiresAt === null ||
      record.refreshTokenExpiresAt <= now)
  ) {
    await store.deleteSessionIfCurrent(sessionId, loaded.sealed);
    return { authenticated: false, clearCookie: clearSessionCookie(runtime) };
  }
  if (record.accessTokenExpiresAt > now + REFRESH_EARLY_SECONDS) {
    return { authenticated: true, record, sessionId, setCookie: undefined };
  }

  const lockToken = randomOpaqueId(dependencies);
  const acquired = await store.acquireRefreshLock(sessionId, lockToken, REFRESH_LOCK_MILLISECONDS);
  if (!acquired) {
    const delay = dependencies.delay ?? defaultDelay;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await delay(75);
      loaded = await loadSession(sessionId, runtime, store);
      record = loaded?.record;
      const afterWait = nowSeconds(dependencies);
      if (record !== undefined && record.accessTokenExpiresAt > afterWait + 5) {
        return { authenticated: true, record, sessionId, setCookie: undefined };
      }
    }
    // Never hand a BFF an expired or imminently-expiring bearer token when a
    // concurrent refresher did not publish a usable replacement in time.
    const afterWait = nowSeconds(dependencies);
    if (record !== undefined && record.accessTokenExpiresAt > afterWait + 5) {
      return { authenticated: true, record, sessionId, setCookie: undefined };
    }
    return { authenticated: false, clearCookie: undefined };
  }

  try {
    // The contender may have read before the lock owner published a rotated
    // refresh token. Re-read after acquiring the lease and fence every write
    // against this exact ciphertext.
    loaded = await loadSession(sessionId, runtime, store);
    record = loaded?.record;
    const beforeRefresh = nowSeconds(dependencies);
    if (
      loaded === undefined ||
      record === undefined ||
      record.issuer !== runtime.issuer ||
      record.createdAt > beforeRefresh + 5
    ) {
      if (loaded !== undefined) {
        await store.deleteSessionIfCurrent(sessionId, loaded.sealed);
      }
      return { authenticated: false, clearCookie: clearSessionCookie(runtime) };
    }
    if (record.accessTokenExpiresAt > beforeRefresh + REFRESH_EARLY_SECONDS) {
      return { authenticated: true, record, sessionId, setCookie: undefined };
    }
    if (
      record.refreshToken === null ||
      record.refreshTokenExpiresAt === null ||
      record.refreshTokenExpiresAt <= beforeRefresh
    ) {
      if (record.accessTokenExpiresAt > beforeRefresh + 5) {
        return { authenticated: true, record, sessionId, setCookie: undefined };
      }
      await store.deleteSessionIfCurrent(sessionId, loaded.sealed);
      return { authenticated: false, clearCookie: clearSessionCookie(runtime) };
    }

    const validated = await refreshAuthSession(record, runtime, dependencies);
    const replaced = await store.replaceSessionIfCurrent(
      sessionId,
      loaded.sealed,
      sealAuthRecord("session", sessionId, validated.record, runtime, dependencies),
      validated.ttlSeconds,
    );
    if (!replaced) {
      const current = await loadSession(sessionId, runtime, store);
      const afterConflict = nowSeconds(dependencies);
      if (current?.record !== undefined && current.record.accessTokenExpiresAt > afterConflict + 5) {
        return {
          authenticated: true,
          record: current.record,
          sessionId,
          setCookie: undefined,
        };
      }
      return {
        authenticated: false,
        clearCookie: current === undefined ? clearSessionCookie(runtime) : undefined,
      };
    }
    return {
      authenticated: true,
      record: validated.record,
      sessionId,
      setCookie: sessionCookie(sessionId, validated.ttlSeconds, runtime),
    };
  } catch {
    const afterFailure = nowSeconds(dependencies);
    if (record !== undefined && record.accessTokenExpiresAt > afterFailure + 5) {
      return { authenticated: true, record, sessionId, setCookie: undefined };
    }
    if (loaded !== undefined) {
      const deleted = await store.deleteSessionIfCurrent(sessionId, loaded.sealed);
      if (!deleted) {
        const current = await loadSession(sessionId, runtime, store);
        if (current?.record !== undefined && current.record.accessTokenExpiresAt > afterFailure + 5) {
          return {
            authenticated: true,
            record: current.record,
            sessionId,
            setCookie: undefined,
          };
        }
        return {
          authenticated: false,
          clearCookie: current === undefined ? clearSessionCookie(runtime) : undefined,
        };
      }
    }
    return { authenticated: false, clearCookie: clearSessionCookie(runtime) };
  } finally {
    await store.releaseRefreshLock(sessionId, lockToken);
  }
}

export async function endAuthSession(
  request: Request,
  runtime: WebAuthRuntime,
  store: AuthSessionStore,
): Promise<{ readonly clearCookie: string; readonly location: URL }> {
  requireSameOriginMutation(request, runtime);
  const sessionId = verifySignedAuthCookie(
    "session",
    uniqueCookieValue(request, AUTH_SESSION_COOKIE),
    runtime,
  );
  let idToken: string | undefined;
  if (sessionId !== undefined) {
    idToken = (await loadSession(sessionId, runtime, store))?.record?.idToken;
    await store.deleteSession(sessionId);
  }
  const location = new URL(runtime.endSessionEndpoint);
  location.search = new URLSearchParams({
    client_id: runtime.clientId,
    post_logout_redirect_uri: runtime.publicOrigin.toString(),
    ...(idToken === undefined ? {} : { id_token_hint: idToken }),
  }).toString();
  return { clearCookie: clearSessionCookie(runtime), location };
}

export function sessionCookieForTesting(sessionId: string, runtime: WebAuthRuntime): string {
  return `${AUTH_SESSION_COOKIE}=${signedAuthCookie("session", sessionId, runtime)}`;
}
