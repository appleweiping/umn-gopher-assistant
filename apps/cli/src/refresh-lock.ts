import { createHash } from "node:crypto";
import { createServer, type Server } from "node:net";
import { homedir } from "node:os";
import { performance } from "node:perf_hooks";

import { CliError } from "./errors.js";
import { ExitCode } from "./exit-codes.js";

const LOCK_PORT_MINIMUM = 20_000;
const LOCK_PORT_SPAN = 20_000;
const WAIT_LIMIT_MILLISECONDS = 60_000;

export interface CredentialRefreshLock {
  withLock<T>(
    profile: string,
    scope: string,
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ): Promise<T>;
}

function lockError(): CliError {
  return new CliError(
    ExitCode.auth,
    "credential-refresh-lock-unavailable",
    "Secure credential refresh coordination is unavailable. Try again.",
  );
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === code
  );
}

function lockPort(namespace: string, profile: string, scope: string): number {
  const digest = createHash("sha256")
    .update(namespace)
    .update("\0")
    .update(profile)
    .update("\0")
    .update(scope)
    .digest();
  return LOCK_PORT_MINIMUM + (digest.readUInt32BE(0) % LOCK_PORT_SPAN);
}

export function credentialLockPortForTesting(namespace: string, profile: string, scope: string): number {
  return lockPort(namespace, profile, scope);
}

async function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) throw lockError();
  await new Promise<void>((resolve, reject) => {
    const cancel = (): void => {
      clearTimeout(timer);
      reject(lockError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

async function tryAcquire(port: number): Promise<Server | undefined> {
  const server = createServer((socket) => socket.destroy());
  return new Promise<Server | undefined>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener("listening", onListening);
      if (isNodeError(error, "EADDRINUSE")) resolve(undefined);
      else reject(lockError());
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      // Retain a controlled listener for rare post-listen socket errors. The
      // listening server stays referenced so the process cannot exit while a
      // credential mutation is still inside the critical section.
      server.on("error", () => undefined);
      resolve(server);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ exclusive: true, host: "127.0.0.1", port });
  });
}

async function release(server: Server): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

/**
 * A loopback TCP listener is an OS-owned cross-process mutex. Exclusive bind
 * is atomic, does not follow filesystem links, and the kernel releases it on
 * normal exit, exception, kill, or crash, so no stale-lock deletion race exists.
 */
export class SocketCredentialRefreshLock implements CredentialRefreshLock {
  constructor(readonly namespace: string) {
    if (namespace.length < 1 || namespace.length > 4_096) throw lockError();
  }

  async withLock<T>(
    profile: string,
    scope: string,
    signal: AbortSignal | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    const port = lockPort(this.namespace, profile, scope);
    const startedAt = performance.now();
    let server: Server | undefined;
    while (server === undefined) {
      if (signal?.aborted === true || performance.now() - startedAt > WAIT_LIMIT_MILLISECONDS) {
        throw lockError();
      }
      server = await tryAcquire(port);
      if (server === undefined) await abortableDelay(50, signal);
    }
    try {
      return await operation();
    } finally {
      await release(server);
    }
  }
}

export function defaultCredentialLockNamespace(
  environment: NodeJS.ProcessEnv = process.env,
  userHome = homedir(),
): string {
  return environment["UGA_CREDENTIAL_LOCK_NAMESPACE"] ?? `user:${userHome}`;
}
