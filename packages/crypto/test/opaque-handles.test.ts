import { describe, expect, it } from "vitest";

import { createVaultCrypto } from "../src/index.js";

const VAULT_ID = "11111111-1111-4111-8111-111111111111";
const KEY_ID = "22222222-2222-4222-8222-222222222222";
const DEVICE_ID = "33333333-3333-4333-8333-333333333333";

function publicObjectGraphContainsBytes(root: object): boolean {
  const seen = new Set<object>();
  const queue: object[] = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || seen.has(current)) continue;
    seen.add(current);
    for (const key of Reflect.ownKeys(current)) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor === undefined || !("value" in descriptor)) continue;
      const value: unknown = descriptor.value;
      if (value instanceof Uint8Array) return true;
      if (typeof value === "object" && value !== null) queue.push(value);
    }
  }
  return false;
}

describe("opaque key handles", () => {
  it("keeps root and device private bytes outside the public runtime object graph", async () => {
    const crypto = await createVaultCrypto();
    const vault = crypto.generateVaultKey({ vaultId: VAULT_ID, vaultKeyId: KEY_ID });
    const device = crypto.generateDeviceKey({ deviceId: DEVICE_ID });
    const vaultRuntime = vault as unknown as Record<string, unknown>;
    const deviceRuntime = device as unknown as Record<string, unknown>;
    const vaultPrototype = Reflect.getPrototypeOf(vaultRuntime);
    const devicePrototype = Reflect.getPrototypeOf(deviceRuntime);
    if (vaultPrototype === null || devicePrototype === null) throw new Error("Missing handle prototype.");

    expect(Object.keys(vaultRuntime)).toEqual([]);
    expect(Object.keys(deviceRuntime)).toEqual([]);
    expect("secret" in vaultRuntime).toBe(false);
    expect("privateKey" in deviceRuntime).toBe(false);
    expect("sodium" in vaultRuntime).toBe(false);
    expect("sodium" in deviceRuntime).toBe(false);
    expect(publicObjectGraphContainsBytes(vaultRuntime)).toBe(false);
    expect(publicObjectGraphContainsBytes(deviceRuntime)).toBe(false);
    expect(Object.isFrozen(vaultRuntime)).toBe(true);
    expect(Object.isFrozen(deviceRuntime)).toBe(true);
    expect(Object.isFrozen(vaultPrototype)).toBe(true);
    expect(Object.isFrozen(devicePrototype)).toBe(true);
    expect(Reflect.get(vaultPrototype, "constructor")).toBeUndefined();
    expect(Reflect.get(devicePrototype, "constructor")).toBeUndefined();

    expect(Reflect.set(vaultRuntime, "vaultId", DEVICE_ID)).toBe(false);
    expect(Reflect.set(vaultPrototype, "destroy", () => undefined)).toBe(false);
    expect(vault.vaultId).toBe(VAULT_ID);
    expect(vault.vaultKeyId).toBe(KEY_ID);
    const forged = Object.create(vaultPrototype) as typeof vault;
    expect(() =>
      crypto.encryptPayload({
        key: forged,
        plaintext: new Uint8Array(),
        revision: 1,
        baseRevision: null,
      }),
    ).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));

    const envelope = crypto.wrapVaultKeyForDevice({ key: vault, recipient: device.publicKey });
    const restored = crypto.unwrapVaultKeyForDevice({ deviceKey: device, envelope });
    expect(restored.vaultId).toBe(VAULT_ID);
    restored.destroy();
    device.destroy();
    vault.destroy();
  });
});
