import { describe, expect, it, vi } from "vitest";

import type { DeviceKeyEnvelopeV1, DevicePublicKeyV1, VaultKeyringV1 } from "@umn-gopher-assistant/crypto";

import {
  createStrictReadwriteTransaction,
  planDeviceRecipientRotation,
  type TrustedDeviceRecordV1,
  writeVaultRotationRecords,
} from "../lib/personal-vault/idb";

function indexedUuid(index: number): string {
  return `018fb9d8-3ec5-7e8b-a512-${index.toString(16).padStart(12, "0")}`;
}

function devicePublicKey(index: number): DevicePublicKeyV1 {
  return {
    formatVersion: 1,
    deviceId: indexedUuid(100 + index * 2),
    deviceKeyId: indexedUuid(101 + index * 2),
    keyAlgorithm: "X25519",
    publicKey: `public-${String(index)}`,
    publicKeyFingerprint: `fingerprint-${String(index)}`,
    createdAt: new Date(Date.UTC(2026, 6, 19, 0, 0, index)).toISOString(),
    revokedAt: null,
  };
}

function deviceEnvelope(publicKey: DevicePublicKeyV1): DeviceKeyEnvelopeV1 {
  return {
    recipientDeviceId: publicKey.deviceId,
    recipientKeyId: publicKey.deviceKeyId,
    recipientPublicKeyFingerprint: publicKey.publicKeyFingerprint,
    createdAt: publicKey.createdAt,
  } as DeviceKeyEnvelopeV1;
}

function keyringFor(recipients: readonly DevicePublicKeyV1[], includePublicKeys = true): VaultKeyringV1 {
  return {
    ...(includePublicKeys ? { devicePublicKeys: [...recipients] } : {}),
    deviceEnvelopes: recipients.map(deviceEnvelope),
  } as VaultKeyringV1;
}

function trustedDevice(publicKey: DevicePublicKeyV1): TrustedDeviceRecordV1 {
  return { publicKey } as TrustedDeviceRecordV1;
}

describe("personal vault IndexedDB durability boundary", () => {
  it("requests and verifies strict durability for security-sensitive writes", () => {
    const abort = vi.fn();
    const transaction = {
      abort,
      durability: "strict",
    } as unknown as IDBTransaction;
    const transactionSpy = vi.fn(() => transaction);
    const database = {
      transaction: transactionSpy,
    } as unknown as IDBDatabase;

    expect(createStrictReadwriteTransaction(database, ["meta", "payload"])).toBe(transaction);
    expect(transactionSpy).toHaveBeenCalledWith(["meta", "payload"], "readwrite", {
      durability: "strict",
    });
    expect(abort).not.toHaveBeenCalled();
  });

  it("fails closed when an older engine rejects the durability option", () => {
    const database = {
      transaction: vi.fn(() => {
        throw new TypeError("Unsupported transaction options");
      }),
    } as unknown as IDBDatabase;

    expect(() => createStrictReadwriteTransaction(database, "meta")).toThrow(
      "IndexedDB strict durability is unavailable.",
    );
  });

  it("aborts and fails closed when an engine silently ignores strict durability", () => {
    const abort = vi.fn();
    const transaction = { abort, durability: "default" } as unknown as IDBTransaction;
    const database = {
      transaction: vi.fn(() => transaction),
    } as unknown as IDBDatabase;

    expect(() => createStrictReadwriteTransaction(database, "meta")).toThrow(
      "IndexedDB did not honor strict durability.",
    );
    expect(abort).toHaveBeenCalledOnce();
  });

  it.each(["trusted-device", "payload", "keyring"])(
    "aborts the shared root-key rotation transaction when the %s write throws",
    (failingStoreName) => {
      const failure = new DOMException("Structured clone failed", "DataCloneError");
      const abort = vi.fn();
      const puts = new Map(
        ["trusted-device", "payload", "keyring"].map((storeName) => [
          storeName,
          vi.fn(() => {
            if (storeName === failingStoreName) throw failure;
          }),
        ]),
      );
      const objectStore = vi.fn((storeName: string) => ({ put: puts.get(storeName) }));
      const transaction = { abort, objectStore } as unknown as IDBTransaction;

      expect(() => writeVaultRotationRecords(transaction, {} as never, {} as never, {} as never)).toThrow(
        failure,
      );
      expect(abort).toHaveBeenCalledOnce();
      expect(objectStore).toHaveBeenNthCalledWith(1, "trusted-device");
      if (failingStoreName !== "trusted-device") {
        expect(objectStore).toHaveBeenNthCalledWith(2, "payload");
      }
      if (failingStoreName === "keyring") {
        expect(objectStore).toHaveBeenNthCalledWith(3, "keyring");
      }
    },
  );
});

describe("personal vault root-key recipient planning", () => {
  it("retains registered remote devices, removes the replaced local device, and appends its replacement", () => {
    const local = devicePublicKey(1);
    const remote = devicePublicKey(2);
    const replacement = devicePublicKey(3);

    expect(
      planDeviceRecipientRotation(keyringFor([local, remote]), trustedDevice(local), replacement, false),
    ).toEqual({ status: "ready", recipients: [remote, replacement] });
  });

  it("fails closed when a retained legacy envelope has no public descriptor", () => {
    const legacy = devicePublicKey(1);
    const replacement = devicePublicKey(2);

    expect(planDeviceRecipientRotation(keyringFor([legacy], false), null, replacement, false)).toEqual({
      status: "unavailable",
    });
    expect(
      planDeviceRecipientRotation(keyringFor([legacy], false), trustedDevice(legacy), replacement, false),
    ).toEqual({ status: "ready", recipients: [replacement] });
  });

  it("requires consent at capacity and then deterministically removes only the oldest recipient", () => {
    const recipients = Array.from({ length: 32 }, (_, index) => devicePublicKey(index));
    const replacement = devicePublicKey(40);

    expect(planDeviceRecipientRotation(keyringFor(recipients), null, replacement, false)).toEqual({
      status: "capacity",
    });
    expect(planDeviceRecipientRotation(keyringFor(recipients), null, replacement, true)).toEqual({
      status: "ready",
      recipients: [...recipients.slice(1), replacement],
    });
  });
});
