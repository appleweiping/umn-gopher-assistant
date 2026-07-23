import { randomUUID } from "node:crypto";

import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Observable } from "rxjs";

function isContractRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(value);
}

const resolvedRequestIds = new WeakMap<FastifyRequest, string>();

export function ensureRequestId(request: FastifyRequest): string {
  const resolvedRequestId = resolvedRequestIds.get(request);
  if (resolvedRequestId !== undefined) {
    return resolvedRequestId;
  }
  const requestIdHeader = request.headers["x-request-id"];
  const requestId = isContractRequestId(requestIdHeader) ? requestIdHeader : randomUUID();
  resolvedRequestIds.set(request, requestId);
  request.id = requestId;
  return requestId;
}

@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const requestId = ensureRequestId(request);
    reply.header("X-Request-Id", requestId);
    return next.handle();
  }
}
