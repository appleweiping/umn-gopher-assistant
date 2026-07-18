import { Catch, HttpException, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import { ensureRequestId } from "./request-id.interceptor.js";

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string;
  readonly traceId: string;
}

const problemByStatus: Readonly<Record<number, { readonly slug: string; readonly title: string }>> = {
  [HttpStatus.BAD_REQUEST]: { slug: "bad-request", title: "Bad Request" },
  [HttpStatus.UNAUTHORIZED]: { slug: "unauthorized", title: "Unauthorized" },
  [HttpStatus.FORBIDDEN]: { slug: "forbidden", title: "Forbidden" },
  [HttpStatus.NOT_FOUND]: { slug: "not-found", title: "Not Found" },
  [HttpStatus.CONFLICT]: { slug: "conflict", title: "Conflict" },
  [HttpStatus.TOO_MANY_REQUESTS]: { slug: "too-many-requests", title: "Too Many Requests" },
  [HttpStatus.INTERNAL_SERVER_ERROR]: { slug: "internal-server-error", title: "Internal Server Error" },
};

function detailFromResponse(response: string | object): string {
  if (typeof response === "string") {
    return response;
  }
  const message: unknown = "message" in response ? (response as { message?: unknown }).message : undefined;
  if (Array.isArray(message)) {
    return message.filter((item): item is string => typeof item === "string").join("; ");
  }
  return typeof message === "string" ? message : "The request could not be completed.";
}

export function toProblemDetails(exception: unknown, instance: string, traceId: string): ProblemDetails {
  const isHttpException = exception instanceof HttpException;
  const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
  const definition = problemByStatus[status] ?? {
    slug: `http-${String(status)}`,
    title: isHttpException ? exception.name : "Internal Server Error",
  };
  const detail = isHttpException
    ? detailFromResponse(exception.getResponse())
    : "An unexpected error occurred.";

  return {
    type: `https://api.gopher-assistant.example/problems/${definition.slug}`,
    title: definition.title,
    status,
    detail,
    instance,
    traceId,
  };
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();
    const traceId = ensureRequestId(request);
    const problem = toProblemDetails(exception, request.url, traceId);

    void reply.status(problem.status).type("application/problem+json").send(problem);
  }
}
