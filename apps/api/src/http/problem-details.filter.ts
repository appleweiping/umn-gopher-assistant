import { Catch, HttpException, HttpStatus, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import { getBearerChallenge } from "../auth/bearer-auth.errors.js";
import { CatalogUnavailableException } from "./catalog-unavailable.exception.js";
import { ensureRequestId } from "./request-id.interceptor.js";

export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string;
  readonly traceId: string;
  readonly failureCode?: string;
  readonly officialUrl?: string;
  readonly sourceId?: string;
}

const problemByStatus: Readonly<Record<number, { readonly slug: string; readonly title: string }>> = {
  [HttpStatus.BAD_REQUEST]: { slug: "bad-request", title: "Bad Request" },
  [HttpStatus.UNAUTHORIZED]: { slug: "unauthorized", title: "Unauthorized" },
  [HttpStatus.FORBIDDEN]: { slug: "forbidden", title: "Forbidden" },
  [HttpStatus.NOT_FOUND]: { slug: "not-found", title: "Not Found" },
  [HttpStatus.GONE]: { slug: "gone", title: "Gone" },
  [HttpStatus.CONFLICT]: { slug: "conflict", title: "Conflict" },
  [HttpStatus.TOO_MANY_REQUESTS]: { slug: "too-many-requests", title: "Too Many Requests" },
  [HttpStatus.SERVICE_UNAVAILABLE]: { slug: "service-unavailable", title: "Service Unavailable" },
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

  const catalogExtensions =
    exception instanceof CatalogUnavailableException
      ? {
          failureCode: exception.failureCode,
          officialUrl: exception.officialUrl,
          sourceId: exception.sourceId,
        }
      : {};

  return {
    type: `https://api.gopher-assistant.example/problems/${definition.slug}`,
    title: definition.title,
    status,
    detail,
    instance,
    traceId,
    ...catalogExtensions,
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
    const bearerChallenge = getBearerChallenge(exception);

    reply.header("X-Request-Id", traceId);
    if (bearerChallenge !== undefined) {
      reply.header("WWW-Authenticate", bearerChallenge);
    }
    if (exception instanceof CatalogUnavailableException) {
      reply.header("Cache-Control", "no-store");
      reply.header("Retry-After", String(exception.retryAfterSeconds));
    }
    void reply.status(problem.status).type("application/problem+json").send(problem);
  }
}
