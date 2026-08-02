import type {
  AuthorizationManifestV2,
  DeviceAuthorizationPublicKeyV2,
  DevicePairingRequestCanonicalInputV2,
  DevicePairingRequestV2,
  DeviceDescriptorV2,
  DeviceKeyEnvelopeV1,
  DevicePublicKeyV1,
  EncryptedVaultPayloadEnvelopeV2,
  EncryptedVaultPayloadEnvelopeV1,
  RecoveryAuthorizationPublicKeyV2,
  RecoveryKeyEnvelopeV1,
  VaultCommandProofCanonicalInputV2,
  VaultCommandProofV2,
  VaultCommitCanonicalInputV2,
  VaultCommitV2,
  VaultKeyringV1,
  VaultReadProofCanonicalInputV2,
  VaultReadProofV2,
} from "@umn-gopher-assistant/contracts";

declare const vaultKeyHandleBrand: unique symbol;
declare const deviceKeyHandleBrand: unique symbol;
declare const authorizationKeyHandleBrand: unique symbol;

/** An opaque, destroyable reference to a vault key held in memory. */
export interface VaultKeyHandle {
  readonly destroyed: boolean;
  readonly vaultId: string;
  readonly vaultKeyId: string;
  readonly [vaultKeyHandleBrand]: never;
  destroy(): void;
}

/** An opaque, destroyable reference to an X25519 device key held in memory. */
export interface DeviceKeyHandle {
  readonly destroyed: boolean;
  readonly publicKey: DevicePublicKeyV1;
  readonly [deviceKeyHandleBrand]: never;
  destroy(): void;
}

/**
 * Opaque, destroyable reference to an Ed25519 authorization private key.
 * The private seed/key is held only in the crypto package's module-private
 * state and has no export operation.
 */
export interface AuthorizationKeyHandle {
  readonly destroyed: boolean;
  readonly kind: "DEVICE" | "RECOVERY";
  readonly ownerBinding: string;
  readonly deviceId: string | null;
  readonly vaultId: string | null;
  readonly keyId: string;
  readonly publicKey: string;
  readonly fingerprint: string;
  readonly createdAt: string;
  readonly [authorizationKeyHandleBrand]: never;
  destroy(): void;
}

export interface GenerateVaultKeyInput {
  readonly vaultId: string;
  readonly vaultKeyId?: string;
}

export interface GenerateDeviceKeyInput {
  readonly deviceId: string;
  readonly deviceKeyId?: string;
}

export interface EncryptVaultPayloadInput {
  readonly key: VaultKeyHandle;
  readonly plaintext: Uint8Array;
  readonly revision: number;
  readonly baseRevision: number | null;
}

export interface EncryptVaultPayloadV2Input extends EncryptVaultPayloadInput {
  readonly ownerBinding: string;
}

export interface DecryptVaultPayloadInput {
  readonly key: VaultKeyHandle;
  readonly envelope: EncryptedVaultPayloadEnvelopeV1;
}

export interface DecryptVaultPayloadV2Input {
  readonly key: VaultKeyHandle;
  readonly envelope: EncryptedVaultPayloadEnvelopeV2;
}

export interface GenerateAuthorizationKeyInput {
  readonly ownerBinding: string;
  readonly deviceId: string;
  readonly keyId?: string;
}

export interface DeriveRecoveryAuthorizationKeyInput {
  readonly recoveryCode: string;
  readonly ownerBinding: string;
  readonly vaultId: string;
  readonly keyId: string;
}

export interface DeriveDeviceAuthorizationKeyInput {
  readonly ownerBinding: string;
  readonly deviceKey: DeviceKeyHandle;
  readonly keyId: string;
}

export interface CreateDeviceDescriptorV2Input {
  readonly ownerBinding: string;
  readonly encryptionKey: DeviceKeyHandle;
  readonly authorizationKey: AuthorizationKeyHandle;
}

export interface CreateRecoveryAuthorizationPublicKeyV2Input {
  readonly authorizationKey: AuthorizationKeyHandle;
}

export interface SignVaultCommitInput {
  readonly authorizationKey: AuthorizationKeyHandle;
  readonly vaultKey: VaultKeyHandle;
  readonly commit: VaultCommitCanonicalInputV2;
}

export interface VerifyVaultCommitSignatureInput {
  readonly commit: VaultCommitV2;
  readonly publicKey: DeviceAuthorizationPublicKeyV2 | RecoveryAuthorizationPublicKeyV2;
}

export interface RootKeyStateMacInput {
  readonly vaultKey: VaultKeyHandle;
  readonly commit: VaultCommitCanonicalInputV2;
}

export interface VerifyRootKeyStateMacInput {
  readonly vaultKey: VaultKeyHandle;
  readonly commit: VaultCommitV2;
}

export interface SignVaultCommandProofInput {
  readonly authorizationKey: AuthorizationKeyHandle;
  readonly proof: VaultCommandProofCanonicalInputV2;
}

export interface VerifyVaultCommandProofInput {
  readonly proof: VaultCommandProofV2;
  readonly publicKey: DeviceAuthorizationPublicKeyV2 | RecoveryAuthorizationPublicKeyV2;
}

export interface SignVaultReadProofInput {
  readonly authorizationKey: AuthorizationKeyHandle;
  readonly proof: VaultReadProofCanonicalInputV2;
}

export interface VerifyVaultReadProofInput {
  readonly proof: VaultReadProofV2;
  readonly publicKey: DeviceAuthorizationPublicKeyV2 | RecoveryAuthorizationPublicKeyV2;
}

export interface SignDevicePairingRequestInput {
  readonly authorizationKey: AuthorizationKeyHandle;
  readonly request: DevicePairingRequestCanonicalInputV2;
}

export interface VerifyDevicePairingRequestInput {
  readonly request: DevicePairingRequestV2;
}

export interface WrapVaultKeyForDeviceInput {
  readonly key: VaultKeyHandle;
  readonly recipient: DevicePublicKeyV1;
}

export interface UnwrapVaultKeyForDeviceInput {
  readonly deviceKey: DeviceKeyHandle;
  readonly envelope: DeviceKeyEnvelopeV1;
}

export interface CreateRecoveryEnvelopeInput {
  readonly key: VaultKeyHandle;
}

export interface RecoveryEnvelopeResult {
  readonly recoveryCode: string;
  readonly envelope: RecoveryKeyEnvelopeV1;
}

export interface RecoverVaultKeyInput {
  readonly envelope: RecoveryKeyEnvelopeV1;
  readonly recoveryCode: string;
}

export interface CreateVaultKeyringInput {
  readonly key: VaultKeyHandle;
  /** Re-wrap the new root key with an already authenticated recovery secret. */
  readonly recoveryCode?: string;
  readonly revision: number;
  readonly recipients: readonly DevicePublicKeyV1[];
}

export interface VaultKeyringResult {
  readonly keyring: VaultKeyringV1;
  readonly recoveryCode: string;
}

export interface RotateVaultKeyringInput {
  readonly previousKey: VaultKeyHandle;
  readonly previousKeyring: VaultKeyringV1;
  /** Keeps the user's current recovery secret valid across root-key rotation. */
  readonly recoveryCode?: string;
  readonly recipients: readonly DevicePublicKeyV1[];
}

export interface RotatedVaultKeyringResult extends VaultKeyringResult {
  readonly key: VaultKeyHandle;
  /** Payloads still encrypted to the prior vault key must be migrated before it is destroyed. */
  readonly migrationRequired: true;
}

export interface ReencryptPayloadForRotationInput {
  readonly previousKey: VaultKeyHandle;
  readonly nextKey: VaultKeyHandle;
  readonly envelope: EncryptedVaultPayloadEnvelopeV1;
  readonly revision: number;
}

export interface VaultCrypto {
  generateVaultKey(input: GenerateVaultKeyInput): VaultKeyHandle;
  generateDeviceKey(input: GenerateDeviceKeyInput): DeviceKeyHandle;
  generateAuthorizationKey(input: GenerateAuthorizationKeyInput): AuthorizationKeyHandle;
  deriveDeviceAuthorizationKey(input: DeriveDeviceAuthorizationKeyInput): AuthorizationKeyHandle;
  deriveRecoveryAuthorizationKey(input: DeriveRecoveryAuthorizationKeyInput): AuthorizationKeyHandle;
  createDeviceDescriptorV2(input: CreateDeviceDescriptorV2Input): DeviceDescriptorV2;
  createRecoveryAuthorizationPublicKeyV2(
    input: CreateRecoveryAuthorizationPublicKeyV2Input,
  ): RecoveryAuthorizationPublicKeyV2;
  computeAuthorizationPublicKeyFingerprintV2(publicKey: string): string;
  encryptPayload(input: EncryptVaultPayloadInput): EncryptedVaultPayloadEnvelopeV1;
  encryptPayloadV2(input: EncryptVaultPayloadV2Input): EncryptedVaultPayloadEnvelopeV2;
  decryptPayload(input: DecryptVaultPayloadInput): Uint8Array;
  decryptPayloadV2(input: DecryptVaultPayloadV2Input): Uint8Array;
  wrapVaultKeyForDevice(input: WrapVaultKeyForDeviceInput): DeviceKeyEnvelopeV1;
  unwrapVaultKeyForDevice(input: UnwrapVaultKeyForDeviceInput): VaultKeyHandle;
  createRecoveryEnvelope(input: CreateRecoveryEnvelopeInput): RecoveryEnvelopeResult;
  recoverVaultKey(input: RecoverVaultKeyInput): VaultKeyHandle;
  createKeyring(input: CreateVaultKeyringInput): VaultKeyringResult;
  rotateKeyring(input: RotateVaultKeyringInput): RotatedVaultKeyringResult;
  reencryptPayloadForRotation(input: ReencryptPayloadForRotationInput): EncryptedVaultPayloadEnvelopeV1;
  signVaultCommit(input: SignVaultCommitInput): VaultCommitV2;
  verifyVaultCommitSignature(input: VerifyVaultCommitSignatureInput): boolean;
  computeRootKeyStateMac(input: RootKeyStateMacInput): string;
  verifyRootKeyStateMac(input: VerifyRootKeyStateMacInput): boolean;
  signVaultCommandProof(input: SignVaultCommandProofInput): VaultCommandProofV2;
  signRecoveryAuthorization(input: SignVaultCommandProofInput): VaultCommandProofV2;
  verifyVaultCommandProof(input: VerifyVaultCommandProofInput): boolean;
  signVaultReadProof(input: SignVaultReadProofInput): VaultReadProofV2;
  verifyVaultReadProof(input: VerifyVaultReadProofInput): boolean;
  signDevicePairingRequest(input: SignDevicePairingRequestInput): DevicePairingRequestV2;
  verifyDevicePairingRequest(input: VerifyDevicePairingRequestInput): boolean;
  hashVaultPayloadV2(value: EncryptedVaultPayloadEnvelopeV2): string;
  hashVaultKeyringV1(value: VaultKeyringV1): string;
  hashAuthorizationManifestV2(value: AuthorizationManifestV2): string;
  computeVaultCommitHash(value: VaultCommitV2): string;
}

export type {
  AuthorizationManifestV2,
  DeviceAuthorizationPublicKeyV2,
  DevicePairingRequestCanonicalInputV2,
  DevicePairingRequestV2,
  DeviceDescriptorV2,
  DeviceKeyEnvelopeV1,
  DevicePublicKeyV1,
  EncryptedVaultPayloadEnvelopeV2,
  EncryptedVaultPayloadEnvelopeV1,
  RecoveryAuthorizationPublicKeyV2,
  RecoveryKeyEnvelopeV1,
  VaultCommandProofCanonicalInputV2,
  VaultCommandProofV2,
  VaultCommitCanonicalInputV2,
  VaultCommitV2,
  VaultKeyringV1,
  VaultReadProofCanonicalInputV2,
  VaultReadProofV2,
};
