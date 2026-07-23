import { Body, Controller, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AiQueryResponse } from "@umn-gopher-assistant/contracts";

import { Public } from "../auth/auth.decorators.js";
import { ensureRequestId } from "../http/request-id.interceptor.js";
import { AiService } from "./ai.service.js";

@Controller("v1/ai")
export class AiController {
  constructor(private readonly assistant: AiService) {}

  @Post("query")
  @HttpCode(200)
  @Public()
  async query(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AiQueryResponse> {
    reply.header("Cache-Control", "no-store");
    const result = await this.assistant.query(
      body,
      { address: request.ip, headers: request.headers },
      ensureRequestId(request),
      request.headers["content-type"],
    );
    reply.header("RateLimit-Limit", String(result.rateLimit.limit));
    reply.header("RateLimit-Remaining", String(result.rateLimit.remaining));
    reply.header("RateLimit-Reset", String(result.rateLimit.resetAfterSeconds));
    return result.response;
  }
}
