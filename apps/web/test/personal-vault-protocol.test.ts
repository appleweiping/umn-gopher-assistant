import { describe, expect, it } from "vitest";

import {
  PERSONAL_VAULT_MAX_DOCUMENT_BYTES,
  PERSONAL_VAULT_MAX_RECOVERY_CODE_LENGTH,
  PERSONAL_VAULT_MAX_TASK_TITLE_LENGTH,
  PersonalVaultSchemaError,
  createTaskDocument,
  parseLegacyTasks,
  parsePersonalVaultDocumentBytes,
  parseVaultRpcRequest,
  parseVaultRpcResponse,
  serializePersonalVaultDocument,
} from "../lib/personal-vault/protocol";

describe("personal vault task schema", () => {
  it("strictly accepts normalized legacy tasks and canonicalizes the encrypted document", () => {
    const document = parseLegacyTasks('[{"id":"alpha-1","title":"Book tutoring","done":false}]');
    const bytes = serializePersonalVaultDocument(document);
    expect(parsePersonalVaultDocumentBytes(bytes)).toEqual(document);
  });

  it("rejects malformed, duplicate, oversized, and untrusted legacy values without mutating them", () => {
    const invalid = [
      "not json",
      '[{"id":"task","title":" x","done":false}]',
      '[{"id":"task","title":"x","done":false,"extra":true}]',
      '[{"id":"task","title":"x","done":false},{"id":"task","title":"y","done":false}]',
      '[{"id":"task","title":"x\\n","done":false}]',
    ];
    for (const raw of invalid) expect(() => parseLegacyTasks(raw)).toThrow(PersonalVaultSchemaError);
    expect(() => createTaskDocument([{ id: "bad id", title: "x", done: false }])).toThrow(
      PersonalVaultSchemaError,
    );
  });
});

describe("personal vault Worker RPC schema", () => {
  it("accepts each exact protocol request", () => {
    const requests = [
      { id: "inspect", method: "inspect" },
      { id: "setup", method: "begin-setup", source: "legacy", legacyRaw: "[]" },
      { id: "confirm", method: "confirm-setup" },
      { id: "cancel", method: "cancel-setup" },
      { id: "unlock", method: "unlock" },
      {
        id: "recover",
        method: "recover",
        recoveryCode: "UGA1-0000",
        allowOldestDeviceRevocation: false,
      },
      { id: "lock", method: "lock" },
      { id: "add", method: "add-task", title: "Read" },
      { id: "toggle", method: "toggle-task", taskId: "task-1" },
      { id: "import", method: "import-legacy", legacyRaw: "[]" },
    ];
    for (const request of requests) expect(parseVaultRpcRequest(request)).toEqual(request);
  });

  it("rejects malformed or surplus Worker messages before dispatch", () => {
    const rejected: unknown[] = [
      null,
      [],
      "inspect",
      { id: "", method: "inspect" },
      { id: "a".repeat(129), method: "inspect" },
      { id: "x", method: "unknown" },
      { id: "x", method: "inspect", surplus: true },
      { id: "x", method: "recover", recoveryCode: 1, allowOldestDeviceRevocation: false },
      { id: "x", method: "recover", recoveryCode: "UGA1-0000" },
      { id: "x", method: "recover", recoveryCode: "UGA1-0000", allowOldestDeviceRevocation: "yes" },
      { id: "x", method: "begin-setup", source: "legacy", legacyRaw: null },
      { id: "x", method: "begin-setup", source: "other", legacyRaw: "[]" },
      { id: "x", method: "add-task", title: {} },
      { id: "x", method: "toggle-task" },
      { id: "x", method: "import-legacy", legacyRaw: null },
      Object.assign(Object.create({ inherited: true }) as object, { id: "x", method: "inspect" }),
    ];
    for (const request of rejected) expect(parseVaultRpcRequest(request)).toBeNull();
  });

  it("rejects oversized fields before they enter the Worker queue", () => {
    expect(
      parseVaultRpcRequest({
        id: "recover",
        method: "recover",
        recoveryCode: "A".repeat(PERSONAL_VAULT_MAX_RECOVERY_CODE_LENGTH + 1),
        allowOldestDeviceRevocation: false,
      }),
    ).toBeNull();
    expect(
      parseVaultRpcRequest({
        id: "add",
        method: "add-task",
        title: "A".repeat(PERSONAL_VAULT_MAX_TASK_TITLE_LENGTH + 1),
      }),
    ).toBeNull();
    expect(
      parseVaultRpcRequest({
        id: "legacy",
        method: "import-legacy",
        legacyRaw: "A".repeat(PERSONAL_VAULT_MAX_DOCUMENT_BYTES + 1),
      }),
    ).toBeNull();
  });

  it("strictly validates Worker responses and encrypted task snapshots", () => {
    const success = {
      id: "response",
      ok: true,
      method: "add-task",
      snapshot: { revision: 2, tasks: [{ id: "task-1", title: "Read", done: false }] },
    } as const;
    expect(parseVaultRpcResponse(success)).toEqual(success);
    expect(parseVaultRpcResponse({ id: "failure", ok: false, error: { code: "CONFLICT" } })).toEqual({
      id: "failure",
      ok: false,
      error: { code: "CONFLICT" },
    });
    expect(
      parseVaultRpcResponse({
        id: "capacity",
        ok: false,
        error: { code: "DEVICE_ENVELOPE_LIMIT_REACHED" },
      }),
    ).toEqual({
      id: "capacity",
      ok: false,
      error: { code: "DEVICE_ENVELOPE_LIMIT_REACHED" },
    });
    for (const response of [
      { ...success, injected: true },
      { ...success, snapshot: { ...success.snapshot, revision: 0 } },
      {
        ...success,
        snapshot: { ...success.snapshot, tasks: [{ id: "bad id", title: "Read", done: false }] },
      },
      { id: "failure", ok: false, error: { code: "ROOT_KEY" } },
      { id: "failure", ok: false, error: { code: "CONFLICT", detail: "leak" } },
    ]) {
      expect(parseVaultRpcResponse(response)).toBeNull();
    }
  });
});
