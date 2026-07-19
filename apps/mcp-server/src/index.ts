import { pathToFileURL } from "node:url";

import { loadMcpServerConfig } from "./config.js";
import { createMcpHttpServer } from "./http.js";

export { JoseAccessTokenVerifier } from "./auth.js";
export type { AccessTokenVerifier, VerifiedAccessIdentity } from "./auth.js";
export { loadMcpServerConfig } from "./config.js";
export type { McpServerConfig } from "./config.js";
export { createMcpHttpApplication, createMcpHttpServer } from "./http.js";
export { MCP_TOOL_CATALOG, McpToolService } from "./tools.js";
export { FutureWriteConfirmationMachine } from "./write-policy.js";

async function main(): Promise<void> {
  const config = loadMcpServerConfig();
  const { server } = createMcpHttpServer({
    config,
    logger: { error: (event) => console.error(JSON.stringify({ event, service: "gopher-mcp-server" })) },
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.bindHost, () => {
      server.off("error", reject);
      resolve();
    });
  });
  console.log(
    JSON.stringify({
      event: "mcp_server_started",
      host: config.bindHost,
      port: config.port,
      resource: config.resourceUrl.toString(),
    }),
  );

  const shutdown = () => {
    server.close((error) => {
      if (error) {
        console.error(JSON.stringify({ event: "mcp_server_shutdown_failed" }));
        process.exitCode = 1;
      }
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  void main().catch(() => {
    console.error(JSON.stringify({ event: "mcp_server_startup_failed" }));
    process.exitCode = 1;
  });
}
