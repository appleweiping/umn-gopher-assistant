import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  hashedWorkerFilename,
  serviceWorkerSource,
  sha256Hex,
  workerBootstrapSource,
} from "../scripts/vault-worker-artifact.mjs";

describe("content-addressed vault Worker artifacts", () => {
  it("uses the exact SHA-256 of the emitted Worker bytes", () => {
    const digest = sha256Hex(new TextEncoder().encode("abc"));

    expect(digest).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hashedWorkerFilename(digest)).toBe(`personal-vault.worker.${digest}.mjs`);
  });

  it("emits only a relative import of the validated immutable artifact", () => {
    const digest = "a".repeat(64);
    const filename = hashedWorkerFilename(digest);

    expect(workerBootstrapSource(filename)).toBe(`import "./${filename}";\n`);
    expect(() => workerBootstrapSource("../private.mjs")).toThrow(
      "Worker digest must be a lowercase SHA-256 hex string.",
    );
    expect(() => hashedWorkerFilename("A".repeat(64))).toThrow(
      "Worker digest must be a lowercase SHA-256 hex string.",
    );
  });

  it("binds one Service Worker build to exactly one immutable Worker digest", () => {
    const digest = "b".repeat(64);
    const template = 'const digest = "__UGA_VAULT_WORKER_DIGEST__";\n';

    expect(serviceWorkerSource(template, digest)).toBe(`const digest = "${digest}";\n`);
    expect(() => serviceWorkerSource("const digest = 'missing';", digest)).toThrow(
      "Service Worker template must contain the vault Worker digest placeholder once.",
    );
    expect(() =>
      serviceWorkerSource("__UGA_VAULT_WORKER_DIGEST____UGA_VAULT_WORKER_DIGEST__", digest),
    ).toThrow("Service Worker template must contain the vault Worker digest placeholder once.");
    expect(() => serviceWorkerSource(template, "B".repeat(64))).toThrow(
      "Worker digest must be a lowercase SHA-256 hex string.",
    );
  });

  it("renders the production Service Worker with a digest-isolated runtime cache", () => {
    const digest = "c".repeat(64);
    const template = readFileSync(resolve(process.cwd(), "scripts/sw.template.js"), "utf8");
    const source = serviceWorkerSource(template, digest);

    expect(source).not.toContain("__UGA_VAULT_WORKER_DIGEST__");
    expect(source).toContain("vault-runtime-${VAULT_WORKER_BUILD_DIGEST}");
    expect(source).toContain("/personal-vault.worker.${VAULT_WORKER_BUILD_DIGEST}.mjs");
    expect(source).toContain(`const VAULT_WORKER_BUILD_DIGEST = "${digest}";`);
    expect(source).toContain('pathname === "/auth"');
    expect(source).toContain('pathname.startsWith("/auth/")');
  });

  it("creates the short-lived recovery rotation command only after one-time-code confirmation", () => {
    const source = readFileSync(resolve(process.cwd(), "workers/personal-vault.worker.ts"), "utf8");
    const preparation = source.slice(
      source.indexOf("async function prepareRemoteRecoveryRotation"),
      source.indexOf("async function rebaseStaleRemoteRecoveryRotation"),
    );
    const confirmationStart = source.indexOf("async function confirmRemoteRecoveryRotation");
    const confirmation = source.slice(
      confirmationStart,
      source.indexOf("async function resumeRemoteRecovery()", confirmationStart),
    );

    expect(preparation).not.toContain("createVaultRecoveryRotationCommand({");
    expect(confirmation).toContain("createVaultRecoveryRotationCommand({");
    expect(confirmation.indexOf("createVaultRecoveryRotationCommand({")).toBeLessThan(
      confirmation.indexOf("stageRemoteRecoveryRotationV2("),
    );
  });

  it("fails closed on unproven multi-hop recovery-rotation rebases", () => {
    const source = readFileSync(resolve(process.cwd(), "workers/personal-vault.worker.ts"), "utf8");
    const start = source.indexOf("async function rebaseStaleRemoteRecoveryRotation");
    const rebase = source.slice(start, source.indexOf("async function finishRemoteRecoveryRotation", start));

    expect(rebase).toContain("classifyVerifiedPendingUpdateHead({");
    expect(rebase).toContain('classification !== "payload-child"');
    expect(rebase).not.toMatch(/commit\.sequence\s*[<>]=?\s*sync\.highWater\.sequence/u);
  });

  it("publishes reopened vault state only after setup upload and unlock synchronization succeed", () => {
    const source = readFileSync(resolve(process.cwd(), "workers/personal-vault.worker.ts"), "utf8");
    const setupStart = source.indexOf("async function confirmSetup");
    const setup = source.slice(setupStart, source.indexOf("async function enableAccountSync", setupStart));
    const unlockStart = source.indexOf('case "unlock":');
    const unlock = source.slice(unlockStart, source.indexOf('case "recover":', unlockStart));
    const recoveryStart = source.indexOf('case "recover":');
    const recovery = source.slice(recoveryStart, source.indexOf('case "lock":', recoveryStart));

    expect(setup).toContain("prepareVaultStateForPublication(");
    expect(setup.indexOf("await uploadPending(candidate")).toBeLessThan(setup.indexOf("unlocked = readBack"));
    expect(unlock).toContain("prepareVaultStateForPublication(");
    expect(unlock.indexOf("await synchronizeUnlocked(candidate)")).toBeLessThan(
      unlock.indexOf("unlocked = nextState"),
    );
    expect(unlock).not.toContain("unlocked = await unlockPersistedVault()");
    expect(recovery.indexOf("await readPersistedVaultSyncV2()")).toBeLessThan(
      recovery.indexOf("unlocked = readBack"),
    );
  });
});
