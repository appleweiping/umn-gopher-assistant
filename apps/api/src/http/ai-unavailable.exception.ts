import { HttpException, HttpStatus, ServiceUnavailableException } from "@nestjs/common";

const FAILURE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/u;

function checkedRetryAfter(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 3_600) {
    throw new RangeError("retryAfterSeconds must be between 1 and 3600");
  }
  return value;
}

function checkedRateLimitValue(value: number, name: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be a safe integer greater than or equal to ${String(minimum)}`);
  }
  return value;
}

export class AiUnavailableException extends ServiceUnavailableException {
  readonly failureCode: string;
  readonly retryAfterSeconds: number;

  constructor(failureCode: string, retryAfterSeconds = 30) {
    super("Campus knowledge search is temporarily unavailable. Try again later.");
    if (!FAILURE_CODE.test(failureCode)) throw new TypeError("failureCode is invalid");
    this.name = "AiUnavailableException";
    this.failureCode = failureCode;
    this.retryAfterSeconds = checkedRetryAfter(retryAfterSeconds);
  }
}

export class AiRateLimitExceededException extends HttpException {
  readonly failureCode = "AI_RATE_LIMITED";
  readonly limit: number;
  readonly remaining: number;
  readonly resetAfterSeconds: number;
  readonly retryAfterSeconds: number;

  constructor(options: {
    readonly limit: number;
    readonly remaining: number;
    readonly resetAfterSeconds: number;
    readonly retryAfterSeconds: number;
  }) {
    super(
      "Campus knowledge search is temporarily rate limited. Try again later.",
      HttpStatus.TOO_MANY_REQUESTS,
    );
    this.name = "AiRateLimitExceededException";
    this.limit = checkedRateLimitValue(options.limit, "limit", 1);
    this.remaining = checkedRateLimitValue(options.remaining, "remaining", 0);
    this.resetAfterSeconds = checkedRetryAfter(options.resetAfterSeconds);
    this.retryAfterSeconds = checkedRetryAfter(options.retryAfterSeconds);
  }
}
