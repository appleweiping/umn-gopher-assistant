import type { CliIo } from "../src/output.js";

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
    status,
  });
}

export interface CapturedIo {
  readonly io: CliIo;
  readonly stderr: string[];
  readonly stdout: string[];
}

export function captureIo(): CapturedIo {
  const stderr: string[] = [];
  const stdout: string[] = [];
  return {
    io: {
      stderr: { write: (chunk) => stderr.push(chunk) },
      stdout: { write: (chunk) => stdout.push(chunk) },
    },
    stderr,
    stdout,
  };
}

export function oidcDiscovery(issuer = "https://identity.example/realms/gopher"): unknown {
  return {
    device_authorization_endpoint: "https://identity.example/device",
    issuer,
    token_endpoint: "https://identity.example/token",
  };
}

export function takeResponse(responses: Response[]): Response {
  const response = responses.shift();
  if (response === undefined) throw new Error("mock response queue exhausted");
  return response;
}
