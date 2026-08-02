import { isIP } from "node:net";
import { Transform, type TransformCallback } from "node:stream";

import { FastifyAdapter } from "@nestjs/platform-fastify";

const MAX_TRUSTED_PROXY_RANGES = 16;
export const DEFAULT_BODY_LIMIT = 1_048_576;
export const AI_QUERY_BODY_LIMIT = 8_192;
export const PERSONAL_VAULT_MUTATION_BODY_LIMIT = 16 * 1_024 * 1_024;

class RequestBodyTooLargeError extends Error {
  readonly code = "FST_ERR_CTP_BODY_TOO_LARGE";
  readonly statusCode = 413;

  constructor(resource: "AI query" | "personal vault mutation") {
    super(`${resource} body exceeds the configured byte limit`);
    this.name = "RequestBodyTooLargeError";
  }
}

class LimitedRequestBody extends Transform {
  receivedEncodedLength = 0;

  constructor(
    private readonly limit: number,
    private readonly resource: "AI query" | "personal vault mutation",
  ) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.receivedEncodedLength += chunk.byteLength;
    if (this.receivedEncodedLength > this.limit) {
      callback(new RequestBodyTooLargeError(this.resource));
      return;
    }
    callback(undefined, chunk);
  }
}

function isAiQueryRequest(method: string, rawUrl: string | undefined): boolean {
  return method === "POST" && rawUrl?.split("?", 1)[0] === "/v1/ai/query";
}

function isPersonalVaultMutation(method: string, rawUrl: string | undefined): boolean {
  const path = rawUrl?.split("?", 1)[0];
  if (path === undefined) return false;
  if (method === "PUT" && path === "/v1/personal/vault/payload") return true;
  if (
    method === "POST" &&
    (path === "/v1/personal/vault" ||
      path === "/v1/personal/vault/device-pairings" ||
      path === "/v1/personal/vault/rotations")
  ) {
    return true;
  }
  return method === "POST" && /^\/v1\/personal\/vault\/device-pairings\/[^/]+\/approval$/u.test(path);
}

function requestBodyPolicy(
  method: string,
  rawUrl: string | undefined,
):
  | {
      readonly limit: number;
      readonly resource: "AI query" | "personal vault mutation";
    }
  | undefined {
  if (isAiQueryRequest(method, rawUrl)) {
    return { limit: AI_QUERY_BODY_LIMIT, resource: "AI query" };
  }
  if (isPersonalVaultMutation(method, rawUrl)) {
    return {
      limit: PERSONAL_VAULT_MUTATION_BODY_LIMIT,
      resource: "personal vault mutation",
    };
  }
  return undefined;
}

function isValidProxyRange(value: string): boolean {
  const [address, prefix, ...extra] = value.split("/");
  if (extra.length > 0 || address === undefined || address.length === 0 || isIP(address) === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/u.test(prefix)) return false;
  const maximum = isIP(address) === 4 ? 32 : 128;
  return Number(prefix) <= maximum;
}

export function trustedProxySetting(
  environment: Readonly<Record<string, string | undefined>>,
): false | string[] {
  if (environment["TRUST_PROXY"] !== undefined) {
    throw new TypeError("TRUST_PROXY is unsafe and unsupported; configure API_TRUSTED_PROXY_CIDRS instead");
  }
  const raw = environment["API_TRUSTED_PROXY_CIDRS"];
  if (raw === undefined) return false;
  if (raw.trim() !== raw || raw.length === 0) {
    throw new TypeError("API_TRUSTED_PROXY_CIDRS must contain canonical IP addresses or CIDR ranges");
  }
  const ranges = raw.split(",");
  if (
    ranges.length > MAX_TRUSTED_PROXY_RANGES ||
    new Set(ranges).size !== ranges.length ||
    ranges.some((range) => !isValidProxyRange(range))
  ) {
    throw new TypeError(
      `API_TRUSTED_PROXY_CIDRS must contain 1 through ${String(MAX_TRUSTED_PROXY_RANGES)} unique canonical IP addresses or CIDR ranges`,
    );
  }
  return ranges;
}

export function createFastifyAdapter(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): FastifyAdapter {
  const adapter = new FastifyAdapter({
    bodyLimit: DEFAULT_BODY_LIMIT,
    requestIdHeader: "x-request-id",
    routerOptions: { ignoreTrailingSlash: false },
    trustProxy: trustedProxySetting(environment),
  });
  adapter.getInstance().addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (methods.some((method) => isAiQueryRequest(method, route.url))) {
      route.bodyLimit = AI_QUERY_BODY_LIMIT;
      return;
    }
    if (methods.some((method) => isPersonalVaultMutation(method, route.url))) {
      route.bodyLimit = PERSONAL_VAULT_MUTATION_BODY_LIMIT;
    }
  });
  adapter.getInstance().addHook("preParsing", (request, _reply, payload, done) => {
    const policy = requestBodyPolicy(request.method, request.raw.url);
    if (policy === undefined) {
      done(undefined, payload);
      return;
    }
    const declaredLength = request.headers["content-length"];
    if (
      declaredLength !== undefined &&
      /^\d+$/u.test(declaredLength) &&
      Number(declaredLength) > policy.limit
    ) {
      done(new RequestBodyTooLargeError(policy.resource));
      return;
    }
    const limited = new LimitedRequestBody(policy.limit, policy.resource);
    payload.once("error", (error) => limited.destroy(error));
    done(undefined, payload.pipe(limited));
  });
  return adapter;
}
