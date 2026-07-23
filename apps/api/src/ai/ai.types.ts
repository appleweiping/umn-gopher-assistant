import type { AiQueryRequest, AiQueryResponse } from "@umn-gopher-assistant/contracts";

export interface AiKnowledgeClient {
  query(request: AiQueryRequest, traceId: string): Promise<AiQueryResponse>;
}

export interface AiRateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetAfterSeconds: number;
  readonly retryAfterSeconds: number;
}

export interface AiRateLimiter {
  consume(clientKey: string, networkKey: string): Promise<AiRateLimitDecision>;
}
