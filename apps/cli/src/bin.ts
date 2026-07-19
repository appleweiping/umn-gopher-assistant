#!/usr/bin/env node

import {
  assertSupportedNodeRuntime,
  UnsupportedNodeRuntimeError,
  unsupportedNodeRuntimeExitCode,
} from "./runtime.js";

async function main(): Promise<number> {
  try {
    assertSupportedNodeRuntime();
  } catch (error) {
    if (!(error instanceof UnsupportedNodeRuntimeError)) throw error;
    process.stderr.write(`${error.message}\n`);
    return unsupportedNodeRuntimeExitCode;
  }

  // Keep the published entrypoint dependency-free until the runtime policy is
  // satisfied. In particular, configuration and credential modules must not
  // be evaluated by an unsupported Node.js process.
  const { createCli } = await import("./cli.js");
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());

  const application = createCli({ signal: controller.signal });
  return application.run(process.argv.slice(2));
}

process.exitCode = await main();
