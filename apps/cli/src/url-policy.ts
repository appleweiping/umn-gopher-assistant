import { operationDefinitions, type OperationDefinition, type OperationId } from "@umn-gopher-assistant/sdk";

import { CliError } from "./errors.js";
import { ExitCode } from "./exit-codes.js";

const credentialParameterNames = new Set([
  "accesstoken",
  "apikey",
  "auth",
  "authorization",
  "clientsecret",
  "cookie",
  "idtoken",
  "password",
  "passwd",
  "refreshtoken",
  "secret",
  "token",
  "xapikey",
]);

function isCredentialParameterName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/gu, "");
  return (
    credentialParameterNames.has(normalized) ||
    normalized.startsWith("auth") ||
    normalized.endsWith("secret") ||
    normalized.endsWith("token") ||
    normalized.includes("apikey")
  );
}

function isLoopback(hostname: string): boolean {
  const value = hostname.toLowerCase();
  if (value === "localhost" || value === "[::1]") return true;
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(value);
  return match?.slice(1).every((part) => Number(part) <= 255) === true;
}

function endpointError(label: string, message: string): CliError {
  const code = label === "API base URL" ? "invalid-api-base-url" : "invalid-oidc-issuer";
  return new CliError(ExitCode.config, code, `${label} ${message}`);
}

export function normalizeEndpoint(value: string, label: "API base URL" | "OIDC issuer"): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw endpointError(label, "must be an absolute URL.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw endpointError(label, "must use HTTPS unless it targets an explicit loopback host.");
  }
  if (url.username || url.password) {
    throw endpointError(label, "must not contain user information.");
  }
  if (url.search || url.hash) {
    throw endpointError(label, "must not contain a query string or fragment.");
  }
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/`;
  return url;
}

export function normalizeApiBaseUrl(value: string): URL {
  return normalizeEndpoint(value, "API base URL");
}

export function normalizeIssuerUrl(value: string): URL {
  return normalizeEndpoint(value, "OIDC issuer");
}

export function validateRemoteHttpsUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CliError(ExitCode.protocol, "invalid-remote-url", `${label} is not a valid URL.`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new CliError(
      ExitCode.protocol,
      "insecure-remote-url",
      `${label} must use HTTPS unless it targets an explicit loopback host.`,
    );
  }
  if (url.username || url.password || url.hash) {
    throw new CliError(ExitCode.protocol, "unsafe-remote-url", `${label} contains unsafe URL data.`);
  }
  return url;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new CliError(ExitCode.usage, "invalid-request-path", "Request path encoding is invalid.");
  }
}

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 31 || codeUnit === 127) return true;
  }
  return false;
}

function pathTemplatePattern(template: string): RegExp {
  const pieces = template.split(/(\{[^{}]+\})/u).map((piece) => {
    if (/^\{[^{}]+\}$/u.test(piece)) return "[^/]+";
    return piece.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  });
  return new RegExp(`^${pieces.join("")}$`, "u");
}

export interface ValidatedRawRequest {
  readonly operationId: OperationId;
  readonly pathAndQuery: string;
}

export function validateRawRequestPath(input: string): ValidatedRawRequest {
  if (
    input.length === 0 ||
    input.length > 4096 ||
    !input.startsWith("/v1/") ||
    input.startsWith("//") ||
    input.includes("\\") ||
    containsControlCharacter(input) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(input) ||
    input.includes("#")
  ) {
    throw new CliError(
      ExitCode.usage,
      "invalid-request-path",
      "Raw requests require a relative, normalized /v1/... path without a fragment.",
    );
  }

  const queryIndex = input.indexOf("?");
  const path = queryIndex === -1 ? input : input.slice(0, queryIndex);
  if (path.includes("//") || path.includes("%")) {
    throw new CliError(
      ExitCode.usage,
      "invalid-request-path",
      "Request paths must not contain empty segments or percent-encoded path data.",
    );
  }
  for (const segment of path.split("/")) {
    const decoded = decodeSegment(segment);
    if (decoded === "." || decoded === "..") {
      throw new CliError(
        ExitCode.usage,
        "invalid-request-path",
        "Request paths must not contain dot segments.",
      );
    }
  }

  const parsed = new URL(input, "https://uga.invalid");
  if (parsed.origin !== "https://uga.invalid" || parsed.pathname !== path) {
    throw new CliError(
      ExitCode.usage,
      "invalid-request-path",
      "Request path normalization changed its target.",
    );
  }
  const catalog: Readonly<Record<string, OperationDefinition>> = operationDefinitions;
  const implemented = Object.entries(catalog).filter(
    ([, definition]) => definition.runtimeStatus === "implemented" && definition.method === "GET",
  ) as [OperationId, (typeof operationDefinitions)[OperationId]][];
  const match = implemented.find(([, definition]) => pathTemplatePattern(definition.path).test(path));
  if (!match) {
    throw new CliError(
      ExitCode.usage,
      "operation-not-implemented",
      "Raw requests are restricted to paths backed by implemented OpenAPI operations.",
    );
  }

  const allowedQueryParameters: ReadonlySet<string> = new Set(match[1].queryParameterNames);
  const seenQueryParameters = new Set<string>();
  for (const name of parsed.searchParams.keys()) {
    if (isCredentialParameterName(name)) {
      throw new CliError(
        ExitCode.usage,
        "credential-query-forbidden",
        "Credentials must not be supplied in a request query string.",
      );
    }
    if (seenQueryParameters.has(name)) {
      throw new CliError(
        ExitCode.usage,
        "duplicate-query-parameter",
        `Raw request query parameter ${JSON.stringify(name)} must not be repeated.`,
      );
    }
    if (!allowedQueryParameters.has(name)) {
      throw new CliError(
        ExitCode.usage,
        "unknown-query-parameter",
        `Raw request query parameter ${JSON.stringify(name)} is not defined for ${match[0]}.`,
      );
    }
    seenQueryParameters.add(name);
  }
  return { operationId: match[0], pathAndQuery: input };
}

export function resolveRawRequestUrl(baseUrl: URL, pathAndQuery: string): URL {
  const url = new URL(pathAndQuery.replace(/^\//u, ""), baseUrl);
  if (url.origin !== baseUrl.origin) {
    throw new CliError(ExitCode.usage, "unsafe-request-target", "Request target escaped the API origin.");
  }
  return url;
}
