import type { AuthSessionStore } from "../auth/redis-store";
import { webAuthSessionStore } from "../auth/redis-store";
import { loadWebAuthRuntime, type WebAuthRuntime } from "../auth/runtime";
import {
  AUTH_SESSION_MAX_TTL_SECONDS,
  clearSessionCookie,
  type AuthSessionRecord,
} from "../auth/session-records";
import { resolveAuthSession, requireSameOriginMutation, type AuthFlowDependencies } from "../auth/session";
import { createDpopProof, isDpopNonceChallenge, parseDpopNonce } from "../auth/dpop";
import { internalApiBaseUrl } from "../catalog/bff";

const JSON_REQUEST_MEDIA_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/iu;
const JSON_RESPONSE_MEDIA_TYPE = /^application\/(?:problem\+)?json(?:\s*;|$)/iu;
const STRONG_ETAG = /^"[\x21\x23-\x7e]+"$/u;
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{16,128}$/u;
const READ_PROOF = /^[A-Za-z0-9_-]{64,5462}$/u;
const COMPACT_JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_REQUEST_BYTES = 16 * 1_024 * 1_024;
const MAX_RESPONSE_BYTES = 16 * 1_024 * 1_024;
const UPSTREAM_TIMEOUT_MS = 20_000;

export type PersonalVaultProxyOperation =
  | "bootstrap"
  | "read"
  | "create"
  | "update-payload"
  | "list-pairings"
  | "create-pairing"
  | "cancel-pairing"
  | "approve-pairing"
  | "rotate";

type MutationOperation = Exclude<PersonalVaultProxyOperation, "bootstrap" | "read" | "list-pairings">;

interface OperationPolicy {
  readonly body: boolean;
  readonly method: "DELETE" | "GET" | "POST" | "PUT";
  readonly precondition: "if-match" | "if-none-match-create" | "if-none-match-read" | "none";
}

const POLICIES: Readonly<Record<PersonalVaultProxyOperation, OperationPolicy>> = Object.freeze({
  bootstrap: { body: false, method: "GET", precondition: "none" },
  read: { body: false, method: "GET", precondition: "if-none-match-read" },
  create: { body: true, method: "POST", precondition: "if-none-match-create" },
  "update-payload": { body: true, method: "PUT", precondition: "if-match" },
  "list-pairings": { body: false, method: "GET", precondition: "if-none-match-read" },
  "create-pairing": { body: true, method: "POST", precondition: "if-match" },
  "cancel-pairing": { body: false, method: "DELETE", precondition: "if-match" },
  "approve-pairing": { body: true, method: "POST", precondition: "if-match" },
  rotate: { body: true, method: "POST", precondition: "if-match" },
});

export interface PersonalVaultProxyOptions {
  readonly authDependencies?: AuthFlowDependencies;
  readonly authRuntime?: WebAuthRuntime;
  readonly authStore?: AuthSessionStore;
  readonly environment?: NodeJS.ProcessEnv;
  readonly fetch?: typeof fetch;
}

class PersonalProxyRequestError extends Error {
  constructor(readonly status: 400 | 403 | 413 | 415 | 428) {
    super("Personal-vault proxy request rejected");
    this.name = "PersonalProxyRequestError";
  }
}

class PersonalProxyUpstreamError extends Error {
  constructor() {
    super("Personal-vault upstream response rejected");
    this.name = "PersonalProxyUpstreamError";
  }
}

function problem(
  request: Request,
  status: 400 | 401 | 403 | 413 | 415 | 428 | 502 | 503,
  code: string,
  detail: string,
  cookie?: string,
): Response {
  const traceId = crypto.randomUUID();
  const headers = new Headers({
    "Cache-Control": "no-store, private, max-age=0",
    "Content-Type": "application/problem+json",
    "X-Content-Type-Options": "nosniff",
    "X-Request-Id": traceId,
  });
  if (cookie !== undefined) headers.append("Set-Cookie", cookie);
  return Response.json(
    {
      detail,
      failureCode: code,
      instance: new URL(request.url).pathname,
      status,
      title:
        status === 401
          ? "Authentication Required"
          : status === 403
            ? "Forbidden"
            : status === 502
              ? "Bad Gateway"
              : status === 503
                ? "Service Unavailable"
                : "Request Rejected",
      traceId,
      type: `https://gopher-assistant.example/problems/personal-${code.toLowerCase()}`,
    },
    { headers, status },
  );
}

function assertBrowserRequest(request: Request, runtime: WebAuthRuntime, mutation: boolean): void {
  let origin: string;
  try {
    origin = new URL(request.url).origin;
  } catch {
    throw new PersonalProxyRequestError(403);
  }
  if (origin !== runtime.publicOrigin.origin) throw new PersonalProxyRequestError(403);
  if (mutation) {
    try {
      requireSameOriginMutation(request, runtime);
    } catch {
      throw new PersonalProxyRequestError(403);
    }
    return;
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") {
    throw new PersonalProxyRequestError(403);
  }
}

function declaredLength(request: Request): number | undefined {
  const value = request.headers.get("content-length");
  if (value === null) return undefined;
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) throw new PersonalProxyRequestError(400);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new PersonalProxyRequestError(400);
  if (parsed > MAX_REQUEST_BYTES) throw new PersonalProxyRequestError(413);
  return parsed;
}

async function boundedBytes(
  message: Request | Response,
  maximum: number,
  onOverflow: () => Error,
): Promise<Uint8Array> {
  const declared = message.headers.get("content-length");
  if (declared !== null && /^\d+$/u.test(declared) && Number(declared) > maximum) {
    await message.body?.cancel().catch(() => undefined);
    throw onOverflow();
  }
  if (message.body === null) return new Uint8Array();
  const reader = message.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximum) {
        await reader.cancel("Body exceeded personal-vault proxy limit");
        throw onOverflow();
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseObjectJson(bytes: Uint8Array, invalid: () => Error): void {
  try {
    const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw invalid();
  } catch (error) {
    if (error instanceof PersonalProxyRequestError || error instanceof PersonalProxyUpstreamError) {
      throw error;
    }
    throw invalid();
  }
}

async function requestBody(request: Request, policy: OperationPolicy): Promise<Uint8Array | undefined> {
  const hasBody = request.body !== null;
  if (!policy.body) {
    if (hasBody || request.headers.has("content-type") || request.headers.has("content-length")) {
      throw new PersonalProxyRequestError(400);
    }
    return undefined;
  }
  if (!JSON_REQUEST_MEDIA_TYPE.test(request.headers.get("content-type") ?? "")) {
    throw new PersonalProxyRequestError(415);
  }
  const expected = declaredLength(request);
  const bytes = await boundedBytes(request, MAX_REQUEST_BYTES, () => new PersonalProxyRequestError(413));
  if (expected !== undefined && expected !== bytes.byteLength) throw new PersonalProxyRequestError(400);
  parseObjectJson(bytes, () => new PersonalProxyRequestError(400));
  return bytes;
}

function oneHeader(request: Request, name: string): string | undefined {
  return request.headers.get(name) ?? undefined;
}

function forwardConditionalHeaders(request: Request, policy: OperationPolicy, target: Headers): void {
  const ifMatch = oneHeader(request, "if-match");
  const ifNoneMatch = oneHeader(request, "if-none-match");
  if (policy.precondition === "if-match") {
    if (ifMatch === undefined) throw new PersonalProxyRequestError(428);
    if (!STRONG_ETAG.test(ifMatch) || ifMatch.includes(",")) throw new PersonalProxyRequestError(400);
    if (ifNoneMatch !== undefined) throw new PersonalProxyRequestError(400);
    target.set("If-Match", ifMatch);
  } else if (policy.precondition === "if-none-match-create") {
    if (ifNoneMatch === undefined) throw new PersonalProxyRequestError(428);
    if (ifNoneMatch !== "*" || ifMatch !== undefined) throw new PersonalProxyRequestError(400);
    target.set("If-None-Match", "*");
  } else if (policy.precondition === "if-none-match-read") {
    if (ifMatch !== undefined) throw new PersonalProxyRequestError(400);
    if (ifNoneMatch !== undefined) {
      if (!STRONG_ETAG.test(ifNoneMatch) || ifNoneMatch.includes(",")) {
        throw new PersonalProxyRequestError(400);
      }
      target.set("If-None-Match", ifNoneMatch);
    }
  } else if (ifMatch !== undefined || ifNoneMatch !== undefined) {
    throw new PersonalProxyRequestError(400);
  }
}

function operationPath(operation: PersonalVaultProxyOperation, pairingId?: string): string {
  if ((operation === "cancel-pairing" || operation === "approve-pairing") && !UUID.test(pairingId ?? "")) {
    throw new PersonalProxyRequestError(400);
  }
  switch (operation) {
    case "bootstrap":
      return "/v1/personal/vault/bootstrap";
    case "read":
    case "create":
      return "/v1/personal/vault";
    case "update-payload":
      return "/v1/personal/vault/payload";
    case "list-pairings":
    case "create-pairing":
      return "/v1/personal/vault/device-pairings";
    case "cancel-pairing":
      return `/v1/personal/vault/device-pairings/${pairingId}`;
    case "approve-pairing":
      return `/v1/personal/vault/device-pairings/${pairingId}/approval`;
    case "rotate":
      return "/v1/personal/vault/rotations";
  }
}

async function requestHeaders(
  request: Request,
  operation: PersonalVaultProxyOperation,
  policy: OperationPolicy,
  session: AuthSessionRecord,
  proofTarget: URL,
  dpopNonce: string | undefined,
): Promise<Headers> {
  if (!COMPACT_JWT.test(session.accessToken)) throw new PersonalProxyUpstreamError();
  const headers = new Headers({
    Accept: "application/json, application/problem+json",
    Authorization: `DPoP ${session.accessToken}`,
    DPoP: await createDpopProof({
      accessToken: session.accessToken,
      htm: policy.method,
      htu: proofTarget,
      ...(dpopNonce === undefined ? {} : { nonce: dpopNonce }),
      privateJwk: session.dpopPrivateJwk,
    }),
    "X-Request-Id": crypto.randomUUID(),
  });
  if (policy.body) headers.set("Content-Type", "application/json");
  forwardConditionalHeaders(request, policy, headers);
  if (operation === "read") {
    const proof = oneHeader(request, "x-vault-read-proof");
    if (proof === undefined) throw new PersonalProxyRequestError(428);
    if (!READ_PROOF.test(proof)) throw new PersonalProxyRequestError(400);
    headers.set("X-Vault-Read-Proof", proof);
  } else if (request.headers.has("x-vault-read-proof")) {
    throw new PersonalProxyRequestError(400);
  }
  if (
    !(["bootstrap", "read", "list-pairings"] as readonly PersonalVaultProxyOperation[]).includes(operation)
  ) {
    const idempotency = oneHeader(request, "idempotency-key");
    if (idempotency === undefined) throw new PersonalProxyRequestError(428);
    if (!IDEMPOTENCY_KEY.test(idempotency) || /\s/u.test(idempotency)) {
      throw new PersonalProxyRequestError(400);
    }
    headers.set("Idempotency-Key", idempotency);
  } else if (request.headers.has("idempotency-key")) {
    throw new PersonalProxyRequestError(400);
  }
  return headers;
}

function remainingSessionTtl(record: AuthSessionRecord): number {
  const expiresAt = record.refreshTokenExpiresAt ?? record.accessTokenExpiresAt;
  return Math.max(1, Math.min(AUTH_SESSION_MAX_TTL_SECONDS, expiresAt - Math.floor(Date.now() / 1_000)));
}

function safeEtag(value: string | null): string | undefined {
  return value !== null && STRONG_ETAG.test(value) && !value.includes(",") ? value : undefined;
}

function safeResponseHeaders(upstream: Response): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store, private, max-age=0",
    "Content-Type": upstream.headers.get("content-type") ?? "application/json",
    "X-Content-Type-Options": "nosniff",
  });
  const etag = safeEtag(upstream.headers.get("etag"));
  if (etag !== undefined) headers.set("ETag", etag);
  const requestId = upstream.headers.get("x-request-id");
  if (requestId !== null && SAFE_REQUEST_ID.test(requestId)) headers.set("X-Request-Id", requestId);
  const replayed = upstream.headers.get("idempotency-replayed");
  if (replayed === "true" || replayed === "false") headers.set("Idempotency-Replayed", replayed);
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter !== null && /^\d{1,5}$/u.test(retryAfter) && Number(retryAfter) <= 86_400) {
    headers.set("Retry-After", retryAfter);
  }
  const location = upstream.headers.get("location");
  if (location !== null && /^\/v1\/personal\/vault(?:\/[-a-z0-9/]+)?$/u.test(location)) {
    headers.set("Location", location.replace(/^\/v1\/personal/u, "/api/personal"));
  }
  return headers;
}

function acceptedStatus(status: number): boolean {
  return [200, 201, 304, 400, 401, 403, 404, 409, 412, 413, 415, 422, 428, 429, 503].includes(status);
}

function requestFailure(request: Request, error: PersonalProxyRequestError, cookie?: string): Response {
  const code =
    error.status === 403
      ? "CROSS_ORIGIN_REQUEST_REJECTED"
      : error.status === 413
        ? "VAULT_REQUEST_TOO_LARGE"
        : error.status === 415
          ? "UNSUPPORTED_MEDIA_TYPE"
          : error.status === 428
            ? "PRECONDITION_REQUIRED"
            : "INVALID_VAULT_REQUEST";
  return problem(
    request,
    error.status,
    code,
    "The encrypted vault request did not meet its protocol boundary.",
    cookie,
  );
}

export async function handlePersonalVaultProxy(
  request: Request,
  operation: PersonalVaultProxyOperation,
  pairingId?: string,
  options: PersonalVaultProxyOptions = {},
): Promise<Response> {
  const policy = POLICIES[operation];
  let runtime: WebAuthRuntime;
  let store: AuthSessionStore;
  try {
    runtime = options.authRuntime ?? loadWebAuthRuntime(options.environment);
    store = options.authStore ?? (await webAuthSessionStore(runtime));
    if (request.method !== policy.method) throw new PersonalProxyRequestError(400);
    assertBrowserRequest(request, runtime, policy.method !== "GET");
  } catch (error) {
    return error instanceof PersonalProxyRequestError
      ? requestFailure(request, error)
      : problem(request, 503, "AUTH_SESSION_UNAVAILABLE", "Private sync authentication is unavailable.");
  }

  let session: Awaited<ReturnType<typeof resolveAuthSession>>;
  try {
    session = await resolveAuthSession(request, runtime, store, options.authDependencies);
  } catch {
    return problem(request, 503, "AUTH_SESSION_UNAVAILABLE", "Private sync authentication is unavailable.");
  }
  if (!session.authenticated) {
    return problem(
      request,
      401,
      "AUTHENTICATION_REQUIRED",
      "Sign in before using account-bound private sync.",
      session.clearCookie,
    );
  }
  const attachSessionCookie = (response: Response): Response => {
    if (session.setCookie !== undefined) response.headers.append("Set-Cookie", session.setCookie);
    return response;
  };

  let body: Uint8Array | undefined;
  let upstreamUrl: URL;
  let proofTarget: URL;
  let dpopNonce: string | undefined;
  let initialHeaders: Headers;
  try {
    body = await requestBody(request, policy);
    const path = operationPath(operation, pairingId);
    upstreamUrl = new URL(path, internalApiBaseUrl(options.environment));
    proofTarget = new URL(path, runtime.apiDpopOrigin);
    dpopNonce = await store.getResourceDpopNonce(session.sessionId);
    initialHeaders = await requestHeaders(request, operation, policy, session.record, proofTarget, dpopNonce);
  } catch (error) {
    body?.fill(0);
    return attachSessionCookie(
      error instanceof PersonalProxyRequestError
        ? requestFailure(request, error)
        : problem(request, 503, "VAULT_API_MISCONFIGURED", "Private sync is not configured."),
    );
  }

  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason);
  if (request.signal.aborted) abort();
  else request.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Timed out", "TimeoutError")),
    UPSTREAM_TIMEOUT_MS,
  );
  try {
    const fetchUpstream = async (headers: Headers): Promise<Response> =>
      (options.fetch ?? fetch)(upstreamUrl, {
        ...(body === undefined ? {} : { body: Uint8Array.from(body).buffer }),
        cache: "no-store",
        credentials: "omit",
        headers,
        method: policy.method,
        redirect: "error",
        signal: controller.signal,
      });
    let upstream = await fetchUpstream(initialHeaders);
    let challenge = isDpopNonceChallenge(upstream);
    if (challenge !== undefined) {
      await upstream.body?.cancel().catch(() => undefined);
      await store.putResourceDpopNonce(session.sessionId, challenge, remainingSessionTtl(session.record));
      dpopNonce = challenge;
      upstream = await fetchUpstream(
        await requestHeaders(request, operation, policy, session.record, proofTarget, challenge),
      );
      challenge = isDpopNonceChallenge(upstream);
      if (challenge !== undefined) {
        await store.putResourceDpopNonce(session.sessionId, challenge, remainingSessionTtl(session.record));
        await upstream.body?.cancel().catch(() => undefined);
        throw new PersonalProxyUpstreamError();
      }
    }
    const responseNonce = parseDpopNonce(upstream.headers.get("dpop-nonce"));
    if (responseNonce !== undefined) {
      await store.putResourceDpopNonce(session.sessionId, responseNonce, remainingSessionTtl(session.record));
    }
    if (!acceptedStatus(upstream.status)) {
      await upstream.body?.cancel().catch(() => undefined);
      throw new PersonalProxyUpstreamError();
    }
    if (upstream.status === 304) {
      const responseHeaders = safeResponseHeaders(upstream);
      if (policy.precondition !== "if-none-match-read" || !responseHeaders.has("ETag")) {
        throw new PersonalProxyUpstreamError();
      }
      responseHeaders.delete("Content-Type");
      return attachSessionCookie(new Response(null, { headers: responseHeaders, status: 304 }));
    }
    if (!JSON_RESPONSE_MEDIA_TYPE.test(upstream.headers.get("content-type") ?? "")) {
      await upstream.body?.cancel().catch(() => undefined);
      throw new PersonalProxyUpstreamError();
    }
    const responseBody = await boundedBytes(
      upstream,
      MAX_RESPONSE_BYTES,
      () => new PersonalProxyUpstreamError(),
    );
    parseObjectJson(responseBody, () => new PersonalProxyUpstreamError());
    const responseHeaders = safeResponseHeaders(upstream);
    if (upstream.status === 401) {
      await store.deleteSession(session.sessionId).catch(() => undefined);
      responseHeaders.append("Set-Cookie", clearSessionCookie(runtime));
      return new Response(Uint8Array.from(responseBody).buffer, {
        headers: responseHeaders,
        status: upstream.status,
      });
    }
    return attachSessionCookie(
      new Response(Uint8Array.from(responseBody).buffer, {
        headers: responseHeaders,
        status: upstream.status,
      }),
    );
  } catch (error) {
    return attachSessionCookie(
      problem(
        request,
        error instanceof PersonalProxyUpstreamError ? 502 : 503,
        error instanceof PersonalProxyUpstreamError ? "INVALID_VAULT_UPSTREAM" : "VAULT_API_UNAVAILABLE",
        error instanceof PersonalProxyUpstreamError
          ? "The private sync service returned an invalid response."
          : "The private sync service is temporarily unavailable.",
      ),
    );
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abort);
    body?.fill(0);
  }
}

export function isMutationOperation(operation: PersonalVaultProxyOperation): operation is MutationOperation {
  return POLICIES[operation].method !== "GET";
}
