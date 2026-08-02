import sodium from "libsodium-wrappers-sumo";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthorizationManifestV2Schema,
  DeviceDescriptorV2Schema,
  encodeVaultReadProofHeaderV2,
  EncryptedVaultPayloadEnvelopeV2Schema,
  VaultCommitV2Schema,
  VaultReadProofV2Schema,
  type VaultCommitCanonicalInputV2,
} from "@umn-gopher-assistant/contracts";

import {
  createBrowserDeviceWrappingKey,
  openBrowserDeviceKey,
  sealBrowserDeviceKey,
} from "../src/browser.js";
import { createVaultCrypto, VaultCryptoErrorCode } from "../src/index.js";
import { createVaultHandle } from "../src/internal/handles.js";

const OWNER_BINDING = Buffer.alloc(32, 1).toString("base64url");
const VAULT_ID = "018fb9d8-3ec5-7e8b-a512-35f8ff523110";
const VAULT_KEY_ID = "018fb9d8-3ec5-7e8b-a512-35f8ff523111";
const DEVICE_ID = "018fb9d8-3ec5-7e8b-a512-35f8ff523112";
const ENCRYPTION_KEY_ID = "018fb9d8-3ec5-7e8b-a512-35f8ff523113";
const AUTHORIZATION_KEY_ID = "018fb9d8-3ec5-7e8b-a512-35f8ff523114";
const RECOVERY_KEY_ID = "018fb9d8-3ec5-7e8b-a512-35f8ff523115";
const OPERATION_ID = "018fb9d8-3ec5-7e8b-a512-35f8ff523116";
const CREATED_AT = "2026-07-23T00:00:00.000Z";
const RECOVERY_CODE = "UGA1-000G-40R4-0M30-E209-185G-R38E-1W81-24GK";

const encodedBytes = (length: number, fill: number): string =>
  Buffer.alloc(length, fill).toString("base64url");
const flipBase64Url = (value: string): string => `${value.startsWith("A") ? "B" : "A"}${value.slice(1)}`;

afterEach(() => {
  vi.useRealTimers();
});

describe("account-bound vault crypto v2", () => {
  it("keeps V2 payload plaintext server-blind and authenticates owner binding", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(CREATED_AT));
    const crypto = await createVaultCrypto();
    const vault = crypto.generateVaultKey({ vaultId: VAULT_ID, vaultKeyId: VAULT_KEY_ID });
    const plaintext = new TextEncoder().encode('{"tasks":[{"title":"private"}]}');
    const envelope = crypto.encryptPayloadV2({
      key: vault,
      ownerBinding: OWNER_BINDING,
      plaintext,
      revision: 1,
      baseRevision: null,
    });
    expect(EncryptedVaultPayloadEnvelopeV2Schema.parse(envelope)).toEqual(envelope);
    expect(new TextDecoder().decode(crypto.decryptPayloadV2({ key: vault, envelope }))).toBe(
      '{"tasks":[{"title":"private"}]}',
    );
    expect(() =>
      crypto.decryptPayloadV2({
        key: vault,
        envelope: {
          ...envelope,
          ownerBinding: encodedBytes(32, 2),
        },
      }),
    ).toThrow(expect.objectContaining({ code: VaultCryptoErrorCode.AUTHENTICATION_FAILED }));
    expect(() =>
      crypto.decryptPayloadV2({
        key: vault,
        envelope: { ...envelope, ignored: true } as typeof envelope,
      }),
    ).toThrow(expect.objectContaining({ code: VaultCryptoErrorCode.AUTHENTICATION_FAILED }));
    plaintext.fill(0);
    vault.destroy();
  });

  it("generates a required X25519+Ed25519 descriptor without exposing either private key", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(CREATED_AT));
    const crypto = await createVaultCrypto();
    const encryptionKey = crypto.generateDeviceKey({
      deviceId: DEVICE_ID,
      deviceKeyId: ENCRYPTION_KEY_ID,
    });
    const authorizationKey = crypto.generateAuthorizationKey({
      ownerBinding: OWNER_BINDING,
      deviceId: DEVICE_ID,
      keyId: AUTHORIZATION_KEY_ID,
    });
    const descriptor = crypto.createDeviceDescriptorV2({
      ownerBinding: OWNER_BINDING,
      encryptionKey,
      authorizationKey,
    });
    expect(DeviceDescriptorV2Schema.parse(descriptor)).toEqual(descriptor);
    expect(descriptor.encryptionKey.algorithm).toBe("X25519");
    expect(descriptor.authorizationKey.algorithm).toBe("ED25519");
    expect(crypto.computeAuthorizationPublicKeyFingerprintV2(descriptor.authorizationKey.publicKey)).toBe(
      descriptor.authorizationKey.fingerprint,
    );

    const runtime = authorizationKey as unknown as Record<string, unknown>;
    const prototype = Reflect.getPrototypeOf(runtime) as Record<string, unknown>;
    expect(Object.keys(runtime)).toEqual([]);
    expect("privateKey" in runtime).toBe(false);
    expect("seed" in runtime).toBe(false);
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(Object.isFrozen(prototype)).toBe(true);
    expect(Reflect.get(prototype, "constructor")).toBeUndefined();

    authorizationKey.destroy();
    expect(() =>
      crypto.signVaultReadProof({
        authorizationKey,
        proof: {
          formatVersion: 2,
          ownerBinding: OWNER_BINDING,
          vaultId: VAULT_ID,
          signer: {
            kind: "DEVICE",
            keyId: AUTHORIZATION_KEY_ID,
            deviceId: DEVICE_ID,
          },
          nonce: encodedBytes(32, 3),
          issuedAt: CREATED_AT,
          expiresAt: "2026-07-23T00:01:00.000Z",
        },
      }),
    ).toThrow(expect.objectContaining({ code: VaultCryptoErrorCode.DESTROYED_KEY }));
    encryptionKey.destroy();
  });

  it("re-derives the same non-exportable authorization identity after trusted-device reload", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(CREATED_AT));
    const crypto = await createVaultCrypto();
    const device = crypto.generateDeviceKey({
      deviceId: DEVICE_ID,
      deviceKeyId: ENCRYPTION_KEY_ID,
    });
    const firstAuthorization = crypto.deriveDeviceAuthorizationKey({
      ownerBinding: OWNER_BINDING,
      deviceKey: device,
      keyId: AUTHORIZATION_KEY_ID,
    });
    const wrappingKey = await createBrowserDeviceWrappingKey();
    const envelope = await sealBrowserDeviceKey({ deviceKey: device, wrappingKey });
    const persistedPublicKey = structuredClone(device.publicKey);
    const expected = {
      publicKey: firstAuthorization.publicKey,
      fingerprint: firstAuthorization.fingerprint,
    };
    firstAuthorization.destroy();
    device.destroy();

    const restoredDevice = await openBrowserDeviceKey({
      publicKey: persistedPublicKey,
      wrappingKey: structuredClone(wrappingKey),
      envelope,
    });
    const restoredAuthorization = crypto.deriveDeviceAuthorizationKey({
      ownerBinding: OWNER_BINDING,
      deviceKey: restoredDevice,
      keyId: AUTHORIZATION_KEY_ID,
    });
    expect({
      publicKey: restoredAuthorization.publicKey,
      fingerprint: restoredAuthorization.fingerprint,
    }).toEqual(expected);

    const descriptor = crypto.createDeviceDescriptorV2({
      ownerBinding: OWNER_BINDING,
      encryptionKey: restoredDevice,
      authorizationKey: restoredAuthorization,
    });
    const request = crypto.signDevicePairingRequest({
      authorizationKey: restoredAuthorization,
      request: {
        formatVersion: 2,
        ownerBinding: OWNER_BINDING,
        vaultId: VAULT_ID,
        operationId: OPERATION_ID,
        requestingDevice: descriptor,
        pairingCodeCommitment: encodedBytes(32, 26),
        issuedAt: CREATED_AT,
        expiresAt: "2026-07-23T00:15:00.000Z",
      },
    });
    expect(crypto.verifyDevicePairingRequest({ request })).toBe(true);
    expect(
      crypto.verifyDevicePairingRequest({
        request: { ...request, pairingCodeCommitment: encodedBytes(32, 27) },
      }),
    ).toBe(false);

    restoredAuthorization.destroy();
    restoredDevice.destroy();
  });

  it("matches deterministic recovery authorization, commit, MAC, and hash vectors", async () => {
    await sodium.ready;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(CREATED_AT));
    const crypto = await createVaultCrypto();
    const recovery = crypto.deriveRecoveryAuthorizationKey({
      recoveryCode: RECOVERY_CODE,
      ownerBinding: OWNER_BINDING,
      vaultId: VAULT_ID,
      keyId: RECOVERY_KEY_ID,
    });
    const publicKey = crypto.createRecoveryAuthorizationPublicKeyV2({
      authorizationKey: recovery,
    });
    const vault = createVaultHandle(
      sodium,
      VAULT_ID,
      VAULT_KEY_ID,
      Uint8Array.from({ length: 32 }, (_, index) => index + 1),
    );
    const commitBody: VaultCommitCanonicalInputV2 = {
      formatVersion: 2,
      ownerBinding: OWNER_BINDING,
      vaultId: VAULT_ID,
      epoch: 1,
      sequence: 1,
      parentCommitHash: null,
      payloadHash: encodedBytes(32, 10),
      keyringHash: encodedBytes(32, 11),
      authorizationManifestHash: encodedBytes(32, 12),
      operationId: OPERATION_ID,
      author: {
        kind: "RECOVERY",
        keyId: RECOVERY_KEY_ID,
        deviceId: null,
      },
      createdAt: CREATED_AT,
    };
    const commit = crypto.signVaultCommit({
      authorizationKey: recovery,
      vaultKey: vault,
      commit: commitBody,
    });
    expect(VaultCommitV2Schema.parse(commit)).toEqual(commit);
    expect(crypto.verifyVaultCommitSignature({ commit, publicKey })).toBe(true);
    expect(crypto.verifyRootKeyStateMac({ vaultKey: vault, commit })).toBe(true);
    const recoveryProof = crypto.signRecoveryAuthorization({
      authorizationKey: recovery,
      proof: {
        formatVersion: 2,
        commandType: "ROTATE_KEY",
        ownerBinding: OWNER_BINDING,
        vaultId: VAULT_ID,
        operationId: OPERATION_ID,
        expectedParentCommitHash: crypto.computeVaultCommitHash(commit),
        nextCommitHash: encodedBytes(32, 19),
        signer: commit.author,
        issuedAt: CREATED_AT,
        expiresAt: "2026-07-23T00:05:00.000Z",
      },
    });
    expect(crypto.verifyVaultCommandProof({ proof: recoveryProof, publicKey })).toBe(true);
    expect({
      publicKey,
      stateMac: commit.stateMac,
      signature: commit.signature,
      commitHash: crypto.computeVaultCommitHash(commit),
      recoveryAuthorizationSignature: recoveryProof.signature,
    }).toMatchInlineSnapshot(`
      {
        "commitHash": "HpuFGZFmmTV_DvJLhNHroPNuwuu2i9btT-BYtF43YQs",
        "publicKey": {
          "algorithm": "ED25519",
          "createdAt": "2026-07-23T00:00:00.000Z",
          "fingerprint": "PQ8B2clCPcoAIE5FEiGwA9oSsxcwp1diUQJ4j8Z55D4",
          "formatVersion": 2,
          "keyId": "018fb9d8-3ec5-7e8b-a512-35f8ff523115",
          "ownerBinding": "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
          "publicKey": "msEdlvLI4OZc7SKVfResPz-qh7CvVShq8AIL9GXrHTk",
          "revokedAt": null,
          "vaultId": "018fb9d8-3ec5-7e8b-a512-35f8ff523110",
        },
        "recoveryAuthorizationSignature": "8l-ztZmeKKZ5B895YEY_HFrCWMYUXdbZIB1VSb4DgtKsuRCM_gY3LB8aTOugOgi0z9WZGr-XPOs17yNxz0ScBA",
        "signature": "ID9klFwSDtjODj8b8JlTIqy7gEQvZBx7ll5cHS2pGr_Z4_ExtMC-o0h-J-7s3_D7hntxvhGZKKP7tavKPzl8Dg",
        "stateMac": "kKHxI0C6Rww6ybtElHinWlWwlX4Hb9PxvdpQya-jQVQ",
      }
    `);

    const tampered = { ...commit, payloadHash: flipBase64Url(commit.payloadHash) };
    expect(VaultCommitV2Schema.safeParse(tampered).success).toBe(true);
    expect(crypto.verifyVaultCommitSignature({ commit: tampered, publicKey })).toBe(false);
    expect(crypto.verifyRootKeyStateMac({ vaultKey: vault, commit: tampered })).toBe(false);

    recovery.destroy();
    vault.destroy();
  });

  it("verifies a random device-authored genesis MAC with a live canonical timestamp", async () => {
    const crypto = await createVaultCrypto();
    const vault = crypto.generateVaultKey({ vaultId: VAULT_ID, vaultKeyId: VAULT_KEY_ID });
    const authorization = crypto.generateAuthorizationKey({
      ownerBinding: OWNER_BINDING,
      deviceId: DEVICE_ID,
      keyId: AUTHORIZATION_KEY_ID,
    });
    const publicKey = {
      keyId: authorization.keyId,
      algorithm: "ED25519",
      publicKey: authorization.publicKey,
      fingerprint: authorization.fingerprint,
    } as const;
    const commitBody = {
      formatVersion: 2,
      ownerBinding: OWNER_BINDING,
      vaultId: VAULT_ID,
      epoch: 1,
      sequence: 1,
      parentCommitHash: null,
      payloadHash: encodedBytes(32, 30),
      keyringHash: encodedBytes(32, 31),
      authorizationManifestHash: encodedBytes(32, 32),
      operationId: OPERATION_ID,
      author: {
        kind: "DEVICE",
        keyId: AUTHORIZATION_KEY_ID,
        deviceId: DEVICE_ID,
      },
      createdAt: new Date().toISOString(),
    } as const;
    const commit = crypto.signVaultCommit({
      authorizationKey: authorization,
      vaultKey: vault,
      commit: commitBody,
    });
    expect(crypto.computeRootKeyStateMac({ vaultKey: vault, commit: commitBody })).toBe(commit.stateMac);
    expect(crypto.verifyRootKeyStateMac({ vaultKey: vault, commit })).toBe(true);
    expect(crypto.verifyVaultCommitSignature({ commit, publicKey })).toBe(true);
    authorization.destroy();
    vault.destroy();
  });

  it("signs bounded command/read proofs and rejects field, key, and fingerprint substitution", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(CREATED_AT));
    const crypto = await createVaultCrypto();
    const authorizationKey = crypto.generateAuthorizationKey({
      ownerBinding: OWNER_BINDING,
      deviceId: DEVICE_ID,
      keyId: AUTHORIZATION_KEY_ID,
    });
    const publicKey = {
      keyId: authorizationKey.keyId,
      algorithm: "ED25519",
      publicKey: authorizationKey.publicKey,
      fingerprint: authorizationKey.fingerprint,
    } as const;
    const signer = {
      kind: "DEVICE",
      keyId: AUTHORIZATION_KEY_ID,
      deviceId: DEVICE_ID,
    } as const;
    const commandProof = crypto.signVaultCommandProof({
      authorizationKey,
      proof: {
        formatVersion: 2,
        commandType: "UPDATE_PAYLOAD",
        ownerBinding: OWNER_BINDING,
        vaultId: VAULT_ID,
        operationId: OPERATION_ID,
        expectedParentCommitHash: encodedBytes(32, 20),
        nextCommitHash: encodedBytes(32, 21),
        signer,
        issuedAt: CREATED_AT,
        expiresAt: "2026-07-23T00:05:00.000Z",
      },
    });
    expect(crypto.verifyVaultCommandProof({ proof: commandProof, publicKey })).toBe(true);
    expect(
      crypto.verifyVaultCommandProof({
        proof: { ...commandProof, nextCommitHash: encodedBytes(32, 22) },
        publicKey,
      }),
    ).toBe(false);
    expect(
      crypto.verifyVaultCommandProof({
        proof: commandProof,
        publicKey: { ...publicKey, fingerprint: encodedBytes(32, 23) },
      }),
    ).toBe(false);
    expect(() =>
      crypto.signVaultCommandProof({
        authorizationKey,
        proof: { ...commandProof, signature: commandProof.signature } as never,
      }),
    ).toThrow(expect.objectContaining({ code: VaultCryptoErrorCode.INVALID_INPUT }));

    const readProof = crypto.signVaultReadProof({
      authorizationKey,
      proof: {
        formatVersion: 2,
        ownerBinding: OWNER_BINDING,
        vaultId: VAULT_ID,
        signer,
        nonce: encodedBytes(32, 24),
        issuedAt: CREATED_AT,
        expiresAt: "2026-07-23T00:02:00.000Z",
      },
    });
    expect(VaultReadProofV2Schema.parse(readProof)).toEqual(readProof);
    expect(crypto.verifyVaultReadProof({ proof: readProof, publicKey })).toBe(true);
    expect(encodeVaultReadProofHeaderV2(readProof)).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(
      crypto.verifyVaultReadProof({
        proof: { ...readProof, nonce: encodedBytes(32, 25) },
        publicKey,
      }),
    ).toBe(false);
    authorizationKey.destroy();
  });

  it("hashes only strict schema-normalized artifacts and binds their exact state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(CREATED_AT));
    const crypto = await createVaultCrypto();
    const vault = crypto.generateVaultKey({ vaultId: VAULT_ID, vaultKeyId: VAULT_KEY_ID });
    const encryption = crypto.generateDeviceKey({
      deviceId: DEVICE_ID,
      deviceKeyId: ENCRYPTION_KEY_ID,
    });
    const authorization = crypto.generateAuthorizationKey({
      ownerBinding: OWNER_BINDING,
      deviceId: DEVICE_ID,
      keyId: AUTHORIZATION_KEY_ID,
    });
    const device = crypto.createDeviceDescriptorV2({
      ownerBinding: OWNER_BINDING,
      encryptionKey: encryption,
      authorizationKey: authorization,
    });
    const recovery = crypto.deriveRecoveryAuthorizationKey({
      recoveryCode: RECOVERY_CODE,
      ownerBinding: OWNER_BINDING,
      vaultId: VAULT_ID,
      keyId: RECOVERY_KEY_ID,
    });
    const recoveryPublic = crypto.createRecoveryAuthorizationPublicKeyV2({
      authorizationKey: recovery,
    });
    const payload = crypto.encryptPayloadV2({
      key: vault,
      ownerBinding: OWNER_BINDING,
      plaintext: new TextEncoder().encode("{}"),
      revision: 1,
      baseRevision: null,
    });
    const keyring = crypto.createKeyring({
      key: vault,
      recoveryCode: RECOVERY_CODE,
      revision: 1,
      recipients: [encryption.publicKey],
    }).keyring;
    const manifest = AuthorizationManifestV2Schema.parse({
      formatVersion: 2,
      ownerBinding: OWNER_BINDING,
      vaultId: VAULT_ID,
      epoch: 1,
      revision: 1,
      devices: [device],
      recoveryAuthorization: recoveryPublic,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
    expect(crypto.hashVaultPayloadV2(payload)).not.toBe(crypto.hashVaultKeyringV1(keyring));
    expect(crypto.hashAuthorizationManifestV2(manifest)).toHaveLength(43);
    expect(() =>
      crypto.hashAuthorizationManifestV2({ ...manifest, ignored: true } as typeof manifest),
    ).toThrow();

    recovery.destroy();
    authorization.destroy();
    encryption.destroy();
    vault.destroy();
  });
});
