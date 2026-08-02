import { timingSafeEqual } from "node:crypto";

import { blake2b } from "@noble/hashes/blake2.js";
import type {
  AuthorizationManifestV2,
  DeviceAuthorizationPublicKeyV2,
  DeviceDescriptorV2,
  DevicePairingRequestV2,
  RecoveryAuthorizationPublicKeyV2,
  VaultCommandProofV2,
  VaultCommitAuthorV2,
  VaultReadProofV2,
  VaultSyncSnapshotV2,
} from "@umn-gopher-assistant/contracts";
import { createVaultCrypto } from "@umn-gopher-assistant/crypto";

const CLOCK_SKEW_MS = 30_000;
const ENCRYPTION_FINGERPRINT_DOMAIN = new TextEncoder().encode("UGA1/DEVICE-PUBLIC-KEY/FINGERPRINT\0");
const vaultCrypto = createVaultCrypto();

export class VaultProtocolError extends Error {
  constructor(
    readonly code: "AUTHORIZATION_FAILED" | "EXPIRED_PROOF" | "INTEGRITY_FAILED" | "OWNER_MISMATCH",
    message: string,
  ) {
    super(message);
    this.name = "VaultProtocolError";
  }
}

function equalCanonicalBytes(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "base64url");
  const rightBytes = Buffer.from(right, "base64url");
  try {
    return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
  } finally {
    leftBytes.fill(0);
    rightBytes.fill(0);
  }
}

function encryptionFingerprint(publicKey: string): string {
  const raw = Buffer.from(publicKey, "base64url");
  const input = new Uint8Array(ENCRYPTION_FINGERPRINT_DOMAIN.byteLength + raw.byteLength);
  input.set(ENCRYPTION_FINGERPRINT_DOMAIN);
  input.set(raw, ENCRYPTION_FINGERPRINT_DOMAIN.byteLength);
  try {
    return Buffer.from(blake2b(input, { dkLen: 32 })).toString("base64url");
  } finally {
    input.fill(0);
    raw.fill(0);
  }
}

async function assertManifestFingerprints(manifest: AuthorizationManifestV2): Promise<void> {
  const crypto = await vaultCrypto;
  for (const device of manifest.devices) {
    if (
      !equalCanonicalBytes(
        encryptionFingerprint(device.encryptionKey.publicKey),
        device.encryptionKey.fingerprint,
      ) ||
      !equalCanonicalBytes(
        crypto.computeAuthorizationPublicKeyFingerprintV2(device.authorizationKey.publicKey),
        device.authorizationKey.fingerprint,
      )
    ) {
      throw new VaultProtocolError(
        "INTEGRITY_FAILED",
        "A device public-key fingerprint does not match its key",
      );
    }
  }
  if (
    !equalCanonicalBytes(
      crypto.computeAuthorizationPublicKeyFingerprintV2(manifest.recoveryAuthorization.publicKey),
      manifest.recoveryAuthorization.fingerprint,
    )
  ) {
    throw new VaultProtocolError(
      "INTEGRITY_FAILED",
      "The recovery authorization fingerprint does not match its key",
    );
  }
}

function assertKeyringRecipients(snapshot: VaultSyncSnapshotV2): void {
  const activeDevices = snapshot.authorizationManifest.devices.filter((device) => device.revokedAt === null);
  if (snapshot.keyring.deviceEnvelopes.length !== activeDevices.length) {
    throw new VaultProtocolError(
      "INTEGRITY_FAILED",
      "Keyring recipients must exactly match active authorization devices",
    );
  }
  for (const device of activeDevices) {
    const envelope = snapshot.keyring.deviceEnvelopes.find(
      (candidate) => candidate.recipientDeviceId === device.deviceId,
    );
    if (
      envelope === undefined ||
      envelope.recipientKeyId !== device.encryptionKey.keyId ||
      envelope.recipientPublicKeyFingerprint !== device.encryptionKey.fingerprint
    ) {
      throw new VaultProtocolError(
        "INTEGRITY_FAILED",
        "An active authorization device has no matching key envelope",
      );
    }
  }
}

function activeSigningKey(
  manifest: AuthorizationManifestV2,
  signer: VaultCommitAuthorV2,
): DeviceAuthorizationPublicKeyV2 | RecoveryAuthorizationPublicKeyV2 | undefined {
  if (signer.kind === "RECOVERY") {
    const recovery = manifest.recoveryAuthorization;
    return recovery.revokedAt === null && recovery.keyId === signer.keyId ? recovery : undefined;
  }
  return manifest.devices.find(
    (candidate) =>
      candidate.revokedAt === null &&
      candidate.deviceId === signer.deviceId &&
      candidate.authorizationKey.keyId === signer.keyId,
  )?.authorizationKey;
}

function assertFreshProof(issuedAt: string, expiresAt: string, now: Date): void {
  const nowMs = now.getTime();
  if (Date.parse(issuedAt) > nowMs + CLOCK_SKEW_MS || Date.parse(expiresAt) <= nowMs) {
    throw new VaultProtocolError(
      "EXPIRED_PROOF",
      "The cryptographic proof is outside its accepted time window",
    );
  }
}

export function hashBase64UrlToHex(value: string): string {
  return Buffer.from(value, "base64url").toString("hex");
}

export function decodedBase64UrlLength(value: string): number {
  return Buffer.from(value, "base64url").byteLength;
}

export async function assertSnapshotIntegrity(snapshot: VaultSyncSnapshotV2): Promise<void> {
  const crypto = await vaultCrypto;
  await assertManifestFingerprints(snapshot.authorizationManifest);
  assertKeyringRecipients(snapshot);
  if (
    !equalCanonicalBytes(snapshot.commit.payloadHash, crypto.hashVaultPayloadV2(snapshot.payload)) ||
    !equalCanonicalBytes(snapshot.commit.keyringHash, crypto.hashVaultKeyringV1(snapshot.keyring)) ||
    !equalCanonicalBytes(
      snapshot.commit.authorizationManifestHash,
      crypto.hashAuthorizationManifestV2(snapshot.authorizationManifest),
    ) ||
    !equalCanonicalBytes(snapshot.commitHash, crypto.computeVaultCommitHash(snapshot.commit))
  ) {
    throw new VaultProtocolError("INTEGRITY_FAILED", "Stored vault artifact hash verification failed");
  }
  const commitKey = activeSigningKey(snapshot.authorizationManifest, snapshot.commit.author);
  if (
    commitKey === undefined ||
    !crypto.verifyVaultCommitSignature({
      commit: snapshot.commit,
      publicKey: commitKey,
    })
  ) {
    throw new VaultProtocolError("INTEGRITY_FAILED", "Stored vault commit signature verification failed");
  }
}

export async function assertCommandProof(
  proof: VaultCommandProofV2,
  manifest: AuthorizationManifestV2,
  now: Date,
): Promise<void> {
  assertFreshProof(proof.issuedAt, proof.expiresAt, now);
  const signingKey = activeSigningKey(manifest, proof.signer);
  const crypto = await vaultCrypto;
  if (signingKey === undefined || !crypto.verifyVaultCommandProof({ proof, publicKey: signingKey })) {
    throw new VaultProtocolError(
      "AUTHORIZATION_FAILED",
      "Command proof was not signed by an active device or recovery key",
    );
  }
}

export async function assertCommitSignature(
  snapshot: VaultSyncSnapshotV2,
  authorizingManifest: AuthorizationManifestV2,
): Promise<void> {
  const signingKey = activeSigningKey(authorizingManifest, snapshot.commit.author);
  const crypto = await vaultCrypto;
  if (
    signingKey === undefined ||
    !crypto.verifyVaultCommitSignature({
      commit: snapshot.commit,
      publicKey: signingKey,
    })
  ) {
    throw new VaultProtocolError(
      "AUTHORIZATION_FAILED",
      "Vault commit was not signed by an active device or recovery key",
    );
  }
}

export async function assertReadProof(
  proof: VaultReadProofV2,
  snapshot: VaultSyncSnapshotV2,
  now: Date,
): Promise<void> {
  assertFreshProof(proof.issuedAt, proof.expiresAt, now);
  if (proof.ownerBinding !== snapshot.ownerBinding || proof.vaultId !== snapshot.vaultId) {
    throw new VaultProtocolError("OWNER_MISMATCH", "Read proof does not belong to the authenticated vault");
  }
  const signingKey = activeSigningKey(snapshot.authorizationManifest, proof.signer);
  const crypto = await vaultCrypto;
  if (signingKey === undefined || !crypto.verifyVaultReadProof({ proof, publicKey: signingKey })) {
    throw new VaultProtocolError(
      "AUTHORIZATION_FAILED",
      "Read proof was not signed by an active device or recovery key",
    );
  }
}

export async function assertPairingRequest(request: DevicePairingRequestV2, now: Date): Promise<void> {
  assertFreshProof(request.issuedAt, request.expiresAt, now);
  const crypto = await vaultCrypto;
  if (
    Date.parse(request.requestingDevice.createdAt) > Date.parse(request.issuedAt) ||
    !equalCanonicalBytes(
      encryptionFingerprint(request.requestingDevice.encryptionKey.publicKey),
      request.requestingDevice.encryptionKey.fingerprint,
    ) ||
    !equalCanonicalBytes(
      crypto.computeAuthorizationPublicKeyFingerprintV2(request.requestingDevice.authorizationKey.publicKey),
      request.requestingDevice.authorizationKey.fingerprint,
    ) ||
    !crypto.verifyDevicePairingRequest({ request })
  ) {
    throw new VaultProtocolError(
      "AUTHORIZATION_FAILED",
      "Pairing request does not prove possession of valid, time-bound pending-device keys",
    );
  }
}

export function findDevice(
  manifest: AuthorizationManifestV2,
  deviceId: string,
): DeviceDescriptorV2 | undefined {
  return manifest.devices.find((device) => device.deviceId === deviceId);
}
