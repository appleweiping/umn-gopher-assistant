import { describe, expect, it } from "vitest";

import {
  PersonalVaultSchemaError,
  createTaskDocument,
  parseLegacyTasks,
  parsePersonalVaultDocumentBytes,
  parseVaultRpcRequest,
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
      { id: "recover", method: "recover", recoveryCode: "UGA1-0000" },
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
      { id: "x", method: "recover", recoveryCode: 1 },
      { id: "x", method: "begin-setup", source: "legacy", legacyRaw: null },
      { id: "x", method: "begin-setup", source: "other", legacyRaw: "[]" },
      { id: "x", method: "add-task", title: {} },
      { id: "x", method: "toggle-task" },
      { id: "x", method: "import-legacy", legacyRaw: null },
      Object.assign(Object.create({ inherited: true }) as object, { id: "x", method: "inspect" }),
    ];
    for (const request of rejected) expect(parseVaultRpcRequest(request)).toBeNull();
  });
});
