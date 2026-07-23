import {
  AiQueryRequestSchema,
  AiQueryResponseSchema,
  type AiQueryRequest,
  type AiQueryResponse,
} from "@umn-gopher-assistant/contracts";

const JSON_MEDIA_TYPE = /^application\/(?:problem\+)?json(?:\s*;|$)/iu;
const MAX_RESPONSE_BYTES = 512 * 1024;

export class AiQueryRequestError extends Error {
  readonly failureCode: string;
  readonly status: number;

  constructor(status: number, failureCode: string) {
    super("The campus query could not be completed.");
    this.name = "AiQueryRequestError";
    this.failureCode = failureCode;
    this.status = status;
  }
}

async function safeJson(response: Response): Promise<unknown> {
  if (!JSON_MEDIA_TYPE.test(response.headers.get("content-type") ?? "")) {
    throw new AiQueryRequestError(502, "INVALID_AI_RESPONSE");
  }
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/u.test(declaredLength) &&
    Number(declaredLength) > MAX_RESPONSE_BYTES
  ) {
    throw new AiQueryRequestError(502, "INVALID_AI_RESPONSE");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
    throw new AiQueryRequestError(502, "INVALID_AI_RESPONSE");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new AiQueryRequestError(502, "INVALID_AI_RESPONSE");
  }
}

function safeFailureCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const failureCode: unknown = (value as Record<string, unknown>)["failureCode"];
  return typeof failureCode === "string" && /^[A-Z][A-Z0-9_]{1,63}$/u.test(failureCode)
    ? failureCode
    : undefined;
}

export async function queryCampusIndex(input: AiQueryRequest, signal: AbortSignal): Promise<AiQueryResponse> {
  const request = AiQueryRequestSchema.safeParse(input);
  if (!request.success) throw new AiQueryRequestError(400, "INVALID_AI_QUERY");

  const response = await fetch("/api/ai/query", {
    body: JSON.stringify(request.data),
    cache: "no-store",
    credentials: "omit",
    headers: { Accept: "application/json, application/problem+json", "Content-Type": "application/json" },
    method: "POST",
    redirect: "error",
    signal,
  });
  const body = await safeJson(response);
  if (!response.ok) {
    throw new AiQueryRequestError(response.status, safeFailureCode(body) ?? "AI_QUERY_FAILED");
  }

  const parsed = AiQueryResponseSchema.safeParse(body);
  if (
    !parsed.success ||
    parsed.data.campusId !== request.data.campusId ||
    parsed.data.locale !== request.data.locale
  ) {
    throw new AiQueryRequestError(502, "AI_CONTRACT_MISMATCH");
  }
  return parsed.data;
}
