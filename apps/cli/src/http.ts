import { CliError } from "./errors.js";
import { ExitCode } from "./exit-codes.js";

const maximumResponseBytes = 1024 * 1024;

export interface HttpDependencies {
  readonly fetch: typeof fetch;
  readonly timeoutMs: number;
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
}

export async function fetchNoRedirect(
  dependencies: HttpDependencies,
  url: URL,
  init: Omit<RequestInit, "redirect" | "signal">,
  signal?: AbortSignal,
): Promise<Response> {
  const request = new Request(url, {
    ...init,
    credentials: "omit",
    redirect: "error",
    signal: requestSignal(signal, dependencies.timeoutMs),
  });
  try {
    return await dependencies.fetch(request);
  } catch (error) {
    if (signal?.aborted === true || (error instanceof DOMException && error.name === "AbortError")) {
      throw new CliError(ExitCode.unavailable, "request-cancelled", "The request was cancelled.");
    }
    throw new CliError(
      ExitCode.unavailable,
      "network-unavailable",
      "The remote service could not be reached.",
    );
  }
}

export async function readLimitedText(
  response: Response,
  maximumBytes = maximumResponseBytes,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new CliError(ExitCode.protocol, "response-too-large", "The remote response exceeded 1 MiB.");
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new CliError(ExitCode.protocol, "response-too-large", "The remote response exceeded 1 MiB.");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function limitResponseBody(response: Response, maximumBytes = maximumResponseBytes): Response {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new CliError(ExitCode.protocol, "response-too-large", "The remote response exceeded 1 MiB.");
  }
  if (response.body === null) return response;
  let receivedBytes = 0;
  const boundedBody = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        receivedBytes += chunk.byteLength;
        if (receivedBytes > maximumBytes) {
          controller.error(
            new CliError(ExitCode.protocol, "response-too-large", "The remote response exceeded 1 MiB."),
          );
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(boundedBody, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json" && contentType !== "application/problem+json") {
    throw new CliError(
      ExitCode.protocol,
      "unexpected-content-type",
      "The remote service did not return JSON.",
      { status: response.status },
    );
  }
  const text = await readLimitedText(response);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CliError(ExitCode.protocol, "malformed-json", "The remote service returned malformed JSON.", {
      status: response.status,
    });
  }
}
