import { isIP } from "node:net";
import { Transform, type TransformCallback } from "node:stream";

import { FastifyAdapter } from "@nestjs/platform-fastify";

const MAX_TRUSTED_PROXY_RANGES = 16;
const AI_QUERY_BODY_LIMIT = 8_192;

class AiQueryBodyTooLargeError extends Error {
  readonly code = "FST_ERR_CTP_BODY_TOO_LARGE";
  readonly statusCode = 413;

  constructor() {
    super("AI query body exceeds the configured byte limit");
    this.name = "AiQueryBodyTooLargeError";
  }
}

class LimitedRequestBody extends Transform {
  receivedEncodedLength = 0;

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.receivedEncodedLength += chunk.byteLength;
    if (this.receivedEncodedLength > AI_QUERY_BODY_LIMIT) {
      callback(new AiQueryBodyTooLargeError());
      return;
    }
    callback(undefined, chunk);
  }
}

function isAiQueryRequest(method: string, rawUrl: string | undefined): boolean {
  return method === "POST" && rawUrl?.split("?", 1)[0] === "/v1/ai/query";
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
    bodyLimit: 1_048_576,
    requestIdHeader: "x-request-id",
    routerOptions: { ignoreTrailingSlash: false },
    trustProxy: trustedProxySetting(environment),
  });
  adapter.getInstance().addHook("preParsing", (request, _reply, payload, done) => {
    if (!isAiQueryRequest(request.method, request.raw.url)) {
      done(undefined, payload);
      return;
    }
    const declaredLength = request.headers["content-length"];
    if (
      declaredLength !== undefined &&
      /^\d+$/u.test(declaredLength) &&
      Number(declaredLength) > AI_QUERY_BODY_LIMIT
    ) {
      done(new AiQueryBodyTooLargeError());
      return;
    }
    const limited = new LimitedRequestBody();
    payload.once("error", (error) => limited.destroy(error));
    done(undefined, payload.pipe(limited));
  });
  return adapter;
}
