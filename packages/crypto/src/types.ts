import type {
  DeviceKeyEnvelopeV1,
  DevicePublicKeyV1,
  EncryptedVaultPayloadEnvelopeV1,
  RecoveryKeyEnvelopeV1,
  VaultKeyringV1,
} from "@umn-gopher-assistant/contracts";

declare const vaultKeyHandleBrand: unique symbol;
declare const deviceKeyHandleBrand: unique symbol;

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

export interface DecryptVaultPayloadInput {
  readonly key: VaultKeyHandle;
  readonly envelope: EncryptedVaultPayloadEnvelopeV1;
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
  encryptPayload(input: EncryptVaultPayloadInput): EncryptedVaultPayloadEnvelopeV1;
  decryptPayload(input: DecryptVaultPayloadInput): Uint8Array;
  wrapVaultKeyForDevice(input: WrapVaultKeyForDeviceInput): DeviceKeyEnvelopeV1;
  unwrapVaultKeyForDevice(input: UnwrapVaultKeyForDeviceInput): VaultKeyHandle;
  createRecoveryEnvelope(input: CreateRecoveryEnvelopeInput): RecoveryEnvelopeResult;
  recoverVaultKey(input: RecoverVaultKeyInput): VaultKeyHandle;
  createKeyring(input: CreateVaultKeyringInput): VaultKeyringResult;
  rotateKeyring(input: RotateVaultKeyringInput): RotatedVaultKeyringResult;
  reencryptPayloadForRotation(input: ReencryptPayloadForRotationInput): EncryptedVaultPayloadEnvelopeV1;
}

export type {
  DeviceKeyEnvelopeV1,
  DevicePublicKeyV1,
  EncryptedVaultPayloadEnvelopeV1,
  RecoveryKeyEnvelopeV1,
  VaultKeyringV1,
};
