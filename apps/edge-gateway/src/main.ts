import { readFile } from "node:fs/promises";

import { loadGatewayRuntimeConfig } from "./config.js";
import { createGatewayServer, type GatewayServer } from "./proxy.js";

async function listen(server: GatewayServer, host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });
}

async function close(server: GatewayServer, graceMilliseconds: number): Promise<void> {
  server.closeIdleConnections();
  const forceClose = setTimeout(() => server.closeAllConnections(), graceMilliseconds);
  forceClose.unref();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  clearTimeout(forceClose);
}

async function main(): Promise<void> {
  const config = loadGatewayRuntimeConfig();
  const tlsMaterial =
    config.tls.mode === "direct"
      ? {
          certificate: await readFile(config.tls.certificateFile),
          privateKey: await readFile(config.tls.keyFile),
        }
      : undefined;
  const server = createGatewayServer(config, tlsMaterial === undefined ? {} : { tlsMaterial });
  await listen(server, config.listenHost, config.listenPort);
  process.stdout.write(
    `${JSON.stringify({
      event: "ready",
      port: config.listenPort,
      tls: config.tls.mode === "direct",
    })}\n`,
  );

  let closing: Promise<void> | undefined;
  const shutDown = (): void => {
    closing ??= close(server, config.shutdownGraceMs);
    void closing.catch(() => {
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", shutDown);
  process.once("SIGTERM", shutDown);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup failure";
  process.stderr.write(`${JSON.stringify({ event: "startup-failed", message })}\n`);
  process.exitCode = 1;
});
