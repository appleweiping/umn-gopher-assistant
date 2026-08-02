import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createCli } from "../src/cli.js";
import { MemorySecretStore, type SecretStore } from "../src/secret-store.js";
import { TEST_DPOP_CREDENTIAL, TEST_DPOP_PRIVATE_JWK, testAccessToken } from "./dpop-fixture.js";
import { captureIo, jsonResponse, oidcDiscovery, takeResponse } from "./helpers.js";

const temporaryDirectories: string[] = [];

async function configPath(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "uga-cli-"));
  temporaryDirectories.push(directory);
  return path.join(directory, "config.json");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("uga command contract", () => {
  it("shows the implemented command families but no contract-only product commands", async () => {
    const captured = captureIo();
    const application = createCli({ io: captured.io, secretStore: new MemorySecretStore() });
    await expect(application.run(["--help"])).resolves.toBe(0);
    const help = captured.stdout.join("");
    expect(help).toContain("campuses");
    expect(help).toContain("sources");
    expect(help).toContain("world");
    expect(help).toContain("request");
    expect(help).not.toMatch(/^\s+(events|community|messages|ai|moderation)\b/gmu);
  });

  it("supports the documented init option order and persists no credentials", async () => {
    const captured = captureIo();
    const file = await configPath();
    const application = createCli({
      configPath: file,
      io: captured.io,
      secretStore: new MemorySecretStore(),
    });
    await expect(
      application.run([
        "init",
        "--profile",
        "local",
        "--api-base-url",
        "http://127.0.0.1:3001",
        "--issuer",
        "http://127.0.0.1:8080/realms/gopher",
        "--json",
      ]),
    ).resolves.toBe(0);
    const envelope = JSON.parse(captured.stdout.join(""));
    expect(envelope).toMatchObject({ command: "init", meta: { profile: "local" }, ok: true });
    const persisted = await readFile(file, "utf8");
    expect(persisted).not.toMatch(/token|password|secret/iu);
  });

  it("returns a stable JSON envelope for a generated SDK command", async () => {
    const captured = captureIo();
    const fetchMock = vi.fn<typeof fetch>(async (request) => {
      if (!(request instanceof Request)) throw new TypeError("expected a Request");
      expect(request.url).toBe("http://127.0.0.1:3001/v1/campuses");
      expect(request.redirect).toBe("error");
      return jsonResponse([], 200, { etag: '"campuses"' });
    });
    const application = createCli({
      configPath: await configPath(),
      fetch: fetchMock,
      io: captured.io,
      secretStore: new MemorySecretStore(),
    });
    await expect(
      application.run([
        "--json",
        "--profile",
        "local",
        "--api-base-url",
        "http://127.0.0.1:3001",
        "campuses",
        "list",
      ]),
    ).resolves.toBe(0);
    expect(captured.stderr).toEqual([]);
    expect(JSON.parse(captured.stdout.join(""))).toEqual({
      command: "campuses.list",
      data: [],
      meta: { profile: "local" },
      ok: true,
    });
  });

  it.each([{}, [{}]])("maps an invalid successful SDK body to protocol exit 7: %j", async (body) => {
    const captured = captureIo();
    const application = createCli({
      configPath: await configPath(),
      fetch: vi.fn<typeof fetch>(async () => jsonResponse(body)),
      io: captured.io,
      secretStore: new MemorySecretStore(),
    });
    await expect(
      application.run(["--json", "--api-base-url", "http://127.0.0.1:3001", "campuses", "list"]),
    ).resolves.toBe(7);
    expect(JSON.parse(captured.stdout.join(""))).toMatchObject({
      command: "campuses.list",
      error: { code: "api-protocol-error", exitCode: 7 },
      ok: false,
    });
  });

  it.each([
    {
      arguments: ["request", "get", "/v1/campuses"],
      label: "object body",
      response: () => jsonResponse({}),
    },
    {
      arguments: ["request", "get", "/v1/campuses"],
      label: "invalid array member",
      response: () => jsonResponse([{}]),
    },
    {
      arguments: ["request", "get", "/v1/campuses"],
      label: "undeclared GET 201",
      response: () => jsonResponse([], 201),
    },
    {
      arguments: ["request", "head", "/v1/campuses"],
      label: "undeclared HEAD 204",
      response: () => new Response(null, { status: 204 }),
    },
  ])("maps raw $label to protocol exit 7", async ({ arguments: commandArguments, response }) => {
    const captured = captureIo();
    const application = createCli({
      configPath: await configPath(),
      fetch: vi.fn<typeof fetch>(async () => response()),
      io: captured.io,
      secretStore: new MemorySecretStore(),
    });
    await expect(
      application.run(["--json", "--api-base-url", "http://127.0.0.1:3001", ...commandArguments]),
    ).resolves.toBe(7);
    expect(JSON.parse(captured.stdout.join(""))).toMatchObject({
      error: { code: "api-protocol-error", exitCode: 7 },
      ok: false,
    });
  });

  it("uses deterministic permission and usage exit codes", async () => {
    const forbidden = captureIo();
    const forbiddenApp = createCli({
      configPath: await configPath(),
      environment: {
        UGA_ACCESS_TOKEN: TEST_DPOP_CREDENTIAL.accessToken,
        UGA_DPOP_PRIVATE_JWK: JSON.stringify(TEST_DPOP_PRIVATE_JWK),
      },
      fetch: vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({
              detail: "Denied",
              instance: "/v1/personal/vault/bootstrap",
              status: 403,
              title: "Forbidden",
              traceId: "trace-safe",
              type: "about:blank",
            }),
            { headers: { "content-type": "application/problem+json" }, status: 403 },
          ),
      ),
      io: forbidden.io,
      secretStore: new MemorySecretStore(),
    });
    await expect(
      forbiddenApp.run([
        "--json",
        "--api-base-url",
        "http://127.0.0.1:3001",
        "--issuer",
        "http://127.0.0.1:8080/realms/gopher",
        "request",
        "get",
        "/v1/personal/vault/bootstrap",
      ]),
    ).resolves.toBe(5);
    expect(JSON.parse(forbidden.stdout.join(""))).toMatchObject({
      error: { code: "permission-denied", exitCode: 5 },
      ok: false,
    });

    const invalid = captureIo();
    const invalidApp = createCli({ io: invalid.io, secretStore: new MemorySecretStore() });
    await expect(invalidApp.run(["--json", "sources", "list", "--limit", "101"])).resolves.toBe(2);
    expect(JSON.parse(invalid.stdout.join(""))).toMatchObject({
      error: { code: "invalid-usage", exitCode: 2 },
      ok: false,
    });
  });

  it("rejects a contract-only command instead of pretending it works", async () => {
    const captured = captureIo();
    const application = createCli({ io: captured.io, secretStore: new MemorySecretStore() });
    await expect(application.run(["--json", "events", "list"])).resolves.toBe(2);
    expect(JSON.parse(captured.stdout.join(""))).toMatchObject({ ok: false });
  });

  it("keeps doctor diagnostic and successful when setup is missing", async () => {
    const captured = captureIo();
    const application = createCli({
      configPath: await configPath(),
      io: captured.io,
      secretStore: new MemorySecretStore(false),
    });
    await expect(application.run(["--json", "doctor"])).resolves.toBe(0);
    expect(JSON.parse(captured.stdout.join(""))).toMatchObject({
      command: "doctor",
      data: {
        api: { reachable: false, status: "not-configured" },
        configured: false,
        identity: { reachable: false, status: "not-configured" },
        pat: { implemented: false, status: "planned" },
      },
      ok: true,
    });
  });

  it("fails closed across processes when secure token storage is unavailable", async () => {
    const captured = captureIo();
    const file = await configPath();
    const responses = [
      jsonResponse(oidcDiscovery("http://127.0.0.1:8080/realms/gopher")),
      jsonResponse({
        device_code: "device-token-must-not-print",
        expires_in: 60,
        interval: 1,
        user_code: "ABCD-EFGH",
        verification_uri: "http://127.0.0.1:8080/verify",
      }),
      jsonResponse({
        access_token: testAccessToken(undefined, "access-token-must-not-print"),
        expires_in: 300,
        refresh_token: "refresh-token-must-not-print",
        scope: "openid campus:read",
        token_type: "DPoP",
      }),
    ];
    const application = createCli({
      configPath: file,
      fetch: vi.fn<typeof fetch>(async () => takeResponse(responses)),
      generateDpopPrivateJwk: () => Promise.resolve(TEST_DPOP_PRIVATE_JWK),
      io: captured.io,
      secretStore: new MemorySecretStore(false),
      sleep: async () => undefined,
    });
    await expect(
      application.run([
        "--json",
        "--profile",
        "local",
        "--issuer",
        "http://127.0.0.1:8080/realms/gopher",
        "auth",
        "login",
      ]),
    ).resolves.toBe(4);
    const allOutput = `${captured.stdout.join("")}\n${captured.stderr.join("")}`;
    expect(allOutput).not.toContain("device-token-must-not-print");
    expect(allOutput).not.toContain("access-token-must-not-print");
    expect(allOutput).not.toContain("refresh-token-must-not-print");
    expect(captured.stdout).toHaveLength(1);
    const result = captured.stdout.at(0);
    if (result === undefined) throw new Error("missing CLI output");
    expect(JSON.parse(result)).toMatchObject({
      command: "auth.login",
      error: { code: "secure-storage-unavailable", exitCode: 4 },
      ok: false,
    });

    const nextProcess = captureIo();
    const nextApplication = createCli({
      configPath: file,
      io: nextProcess.io,
      secretStore: new MemorySecretStore(false),
    });
    await expect(nextApplication.run(["--json", "--profile", "local", "auth", "status"])).resolves.toBe(0);
    expect(JSON.parse(nextProcess.stdout.join(""))).toMatchObject({
      command: "auth.status",
      data: { available: false, source: "missing" },
      ok: true,
    });
  });

  it("maps a keychain deletion failure to auth exit 4 instead of claiming no credential exists", async () => {
    const captured = captureIo();
    const store: SecretStore = {
      availability: () => Promise.resolve({ available: true }),
      delete: () => Promise.resolve({ status: "backend-error" }),
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve(true),
    };
    const application = createCli({
      configPath: await configPath(),
      io: captured.io,
      secretStore: store,
    });

    await expect(application.run(["--json", "--profile", "local", "auth", "logout"])).resolves.toBe(4);
    const output = captured.stdout.join("");
    expect(output).not.toContain("No stored credentials");
    expect(JSON.parse(output)).toMatchObject({
      command: "auth.logout",
      error: { code: "secure-storage-unavailable", exitCode: 4 },
      ok: false,
    });
  });
});
