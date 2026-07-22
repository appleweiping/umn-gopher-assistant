import { ServiceUnavailableException } from "@nestjs/common";

const FAILURE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/u;

export interface CatalogUnavailableOptions {
  readonly failureCode: string;
  readonly officialUrl: string;
  readonly retryAfterSeconds: number;
  readonly sourceId: string;
}

export class CatalogUnavailableException extends ServiceUnavailableException {
  readonly failureCode: string;
  readonly officialUrl: string;
  readonly retryAfterSeconds: number;
  readonly sourceId: string;

  constructor(options: CatalogUnavailableOptions) {
    super("The campus source is unavailable. Use the official source link and try again later.");
    if (!FAILURE_CODE.test(options.failureCode)) throw new TypeError("failureCode is invalid");
    const officialUrl = new URL(options.officialUrl);
    if (officialUrl.protocol !== "https:") throw new TypeError("officialUrl must use HTTPS");
    if (
      !Number.isSafeInteger(options.retryAfterSeconds) ||
      options.retryAfterSeconds < 1 ||
      options.retryAfterSeconds > 86_400
    ) {
      throw new RangeError("retryAfterSeconds must be between 1 and 86400");
    }
    this.name = "CatalogUnavailableException";
    this.failureCode = options.failureCode;
    this.officialUrl = officialUrl.href;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.sourceId = options.sourceId;
  }
}
