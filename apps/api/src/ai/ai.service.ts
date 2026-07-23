import { createHmac } from "node:crypto";

import { BadRequestException, Inject, Injectable, UnsupportedMediaTypeException } from "@nestjs/common";
import {
  AiQueryRequestSchema,
  type AiQueryRequest,
  type AiQueryResponse,
} from "@umn-gopher-assistant/contracts";

import { AiRateLimitExceededException } from "../http/ai-unavailable.exception.js";
import { loadAiBffProofHmacKey, loadAiRateLimitHmacKey } from "../runtime-config.js";
import { verifiedAiBffClientIdentity, type AiInternalHeaders } from "./ai-client-session-proof.js";
import { AI_KNOWLEDGE_CLIENT, AI_RATE_LIMITER } from "./ai.tokens.js";
import type { AiKnowledgeClient, AiRateLimitDecision, AiRateLimiter } from "./ai.types.js";

export interface AiQueryResult {
  readonly response: AiQueryResponse;
  readonly rateLimit: AiRateLimitDecision;
}

const JSON_MEDIA_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/iu;

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 31 || codeUnit === 127) return true;
  }
  return false;
}

interface AiClientContext {
  readonly address: string;
  readonly headers: AiInternalHeaders;
}

function anonymousBucketKey(
  bucket: "client" | "network",
  kind: "ip" | "network" | "session",
  value: string,
  key: Uint8Array,
): string {
  if (value.length < 1 || value.length > 256 || containsControlCharacter(value)) {
    throw new BadRequestException("The request client address is invalid.");
  }
  return createHmac("sha256", key)
    .update(`umn-gopher-assistant:ai-rate-limit-${bucket}:v1\n${kind}\n`, "utf8")
    .update(value, "utf8")
    .digest("base64url");
}

@Injectable()
export class AiService {
  readonly #bffProofKey: Uint8Array;
  readonly #rateLimitKey: Uint8Array;

  constructor(
    @Inject(AI_KNOWLEDGE_CLIENT) private readonly knowledge: AiKnowledgeClient,
    @Inject(AI_RATE_LIMITER) private readonly rateLimiter: AiRateLimiter,
  ) {
    this.#bffProofKey = loadAiBffProofHmacKey();
    this.#rateLimitKey = loadAiRateLimitHmacKey();
  }

  async query(
    candidate: unknown,
    client: AiClientContext,
    traceId: string,
    contentType: string | undefined,
  ): Promise<AiQueryResult> {
    const verifiedIdentity = verifiedAiBffClientIdentity(client.headers, traceId, this.#bffProofKey);
    const rateLimit = await this.rateLimiter.consume(
      anonymousBucketKey(
        "client",
        verifiedIdentity === undefined ? "ip" : "session",
        verifiedIdentity?.sessionId ?? client.address,
        this.#rateLimitKey,
      ),
      anonymousBucketKey(
        "network",
        verifiedIdentity === undefined ? "ip" : "network",
        verifiedIdentity?.networkId ?? client.address,
        this.#rateLimitKey,
      ),
    );
    if (!rateLimit.allowed) throw new AiRateLimitExceededException(rateLimit);
    if (contentType === undefined || !JSON_MEDIA_TYPE.test(contentType)) {
      throw new UnsupportedMediaTypeException("The AI query request must use application/json.");
    }
    const parsed = AiQueryRequestSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new BadRequestException(
        "The AI query must contain a supported campus, locale, and bounded question.",
      );
    }
    const request: AiQueryRequest = parsed.data;
    return { rateLimit, response: await this.knowledge.query(request, traceId) };
  }
}
