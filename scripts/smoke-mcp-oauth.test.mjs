import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { smokeMcpOauthTesting as subject } from "./smoke-mcp-oauth.mjs";

const issuer = "http://127.0.0.1:8080/realms/gopher-assistant-dev";

test("child environment removes inherited credential-like keys case-insensitively", () => {
  const environment = subject.childEnvironment(
    {
      MCP_AUTH_MODE: "oauth",
      MCP_OAUTH_ISSUER: issuer,
      PORT: "4100",
    },
    {
      Authorization: "Bearer inherited",
      cLiEnT_sEcReT: "secret",
      cOoKiE: "session=secret",
      GitHub_Token: "token",
      KeyCloak_Admin: "admin",
      Mixed_Credential: "credential",
      NPM_API_KEY: "api-key",
      PaSsWoRd: "password",
      PATH: "safe-path",
      service_PwD: "password-alias",
      SSH_AUTH_SOCK: "auth-socket",
    },
  );

  assert.deepEqual(environment, {
    MCP_AUTH_MODE: "oauth",
    MCP_OAUTH_ISSUER: issuer,
    PATH: "safe-path",
    PORT: "4100",
  });
  assert.throws(
    () => subject.childEnvironment({ api_Token: "must-not-pass" }, {}),
    /Refusing sensitive child environment key/u,
  );
});

test("resource claims require the exact least-privilege scope and one audience", () => {
  const valid = { aud: subject.mcpAudience, iss: issuer, scope: "campus:read" };
  assert.doesNotThrow(() => subject.assertResourceClaims(valid, issuer, subject.mcpAudience));
  assert.doesNotThrow(() =>
    subject.assertResourceClaims({ ...valid, aud: [subject.mcpAudience] }, issuer, subject.mcpAudience),
  );
  assert.throws(
    () =>
      subject.assertResourceClaims({ ...valid, scope: "campus:read profile" }, issuer, subject.mcpAudience),
    /exact least-privilege scope set/u,
  );
  assert.throws(
    () =>
      subject.assertResourceClaims(
        { ...valid, aud: [subject.mcpAudience, "gopher-api"] },
        issuer,
        subject.mcpAudience,
      ),
    /exact single expected audience/u,
  );
});

test("campus and world results preserve exact IDs and schematic trust indicators", () => {
  const ids = ["tc", "duluth", "crookston", "morris", "rochester"];
  const campusesResult = {
    result: {
      structuredContent: {
        campuses: ids.map((id) => ({ id, officialStatus: "UNVERIFIED" })),
        etag: '"campuses-v1"',
      },
    },
  };
  assert.doesNotThrow(() => subject.assertCampusToolResult(campusesResult));
  assert.throws(
    () =>
      subject.assertCampusToolResult({
        result: {
          structuredContent: {
            ...campusesResult.result.structuredContent,
            campuses: campusesResult.result.structuredContent.campuses.slice(0, 4),
          },
        },
      }),
    /exact five campus IDs/u,
  );

  const worldResult = {
    result: {
      structuredContent: {
        etag: '"tc-schematic-v1"',
        manifest: {
          campusId: "tc",
          etag: '"tc-schematic-v1"',
          verificationState: "schematic",
        },
      },
    },
  };
  assert.doesNotThrow(() => subject.assertWorldToolResult(worldResult, "tc"));
  assert.throws(
    () =>
      subject.assertWorldToolResult(
        {
          result: {
            structuredContent: {
              ...worldResult.result.structuredContent,
              manifest: { ...worldResult.result.structuredContent.manifest, verificationState: "verified" },
            },
          },
        },
        "tc",
      ),
    /schematic indicator/u,
  );
});

test("runtime cleanup waits for a confirmed SIGKILL exit", async () => {
  class Runtime extends EventEmitter {
    exitCode = null;
    signalCode = null;
    signals = [];

    kill(signal) {
      this.signals.push(signal);
      if (signal === "SIGKILL") {
        queueMicrotask(() => {
          this.signalCode = "SIGKILL";
          this.emit("exit", null, "SIGKILL");
        });
      }
      return true;
    }
  }

  const runtime = new Runtime();
  await subject.stopRuntime(runtime, { graceMilliseconds: 1, killMilliseconds: 100 });
  assert.deepEqual(runtime.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(runtime.signalCode, "SIGKILL");
  assert.throws(() => subject.assertRuntimeRunning(runtime), /terminated by a signal/u);
});
