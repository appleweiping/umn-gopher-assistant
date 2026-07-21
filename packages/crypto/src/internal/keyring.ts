import type {
  CreateVaultKeyringInput,
  DevicePublicKeyV1,
  RotateVaultKeyringInput,
  RotatedVaultKeyringResult,
  VaultKeyringResult,
} from "../types.js";
import type { Sodium } from "./sodium.js";

import { VAULT_MAX_DEVICE_ENVELOPES } from "../constants.js";
import { cryptoError, VaultCryptoErrorCode } from "../errors.js";
import { vaultSecret } from "./handles.js";
import { randomUuid } from "./ids.js";
import { currentIsoDateTime, requireRevision, requireUuid } from "./validation.js";
import { createRecoveryEnvelope } from "./recovery.js";
import { wrapVaultKeyForDevice } from "./device.js";
import { createVaultHandle } from "./handles.js";

function validateRecipients(input: CreateVaultKeyringInput["recipients"]): readonly DevicePublicKeyV1[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > VAULT_MAX_DEVICE_ENVELOPES) {
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
  const recipients = input as readonly DevicePublicKeyV1[];
  const deviceIds = new Set<string>();
  const keyIds = new Set<string>();
  for (const recipient of recipients) {
    if (deviceIds.has(recipient.deviceId) || keyIds.has(recipient.deviceKeyId)) {
      throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
    }
    deviceIds.add(recipient.deviceId);
    keyIds.add(recipient.deviceKeyId);
  }
  return recipients;
}

export function createKeyring(sodium: Sodium, input: CreateVaultKeyringInput): VaultKeyringResult {
  vaultSecret(input.key);
  const recipients = validateRecipients(input.recipients);
  const revision = requireRevision(input.revision);
  const createdAt = currentIsoDateTime();
  const deviceEnvelopes = recipients.map((recipient) => wrapVaultKeyForDevice(sodium, input.key, recipient));
  const recovery = createRecoveryEnvelope(sodium, input.key);
  const updatedAt = currentIsoDateTime();
  return {
    recoveryCode: recovery.recoveryCode,
    keyring: {
      formatVersion: 1,
      vaultId: requireUuid(input.key.vaultId),
      vaultKeyId: requireUuid(input.key.vaultKeyId),
      revision,
      deviceEnvelopes,
      recoveryEnvelope: recovery.envelope,
      createdAt,
      updatedAt,
    },
  };
}

export function rotateKeyring(sodium: Sodium, input: RotateVaultKeyringInput): RotatedVaultKeyringResult {
  const previousSecret = vaultSecret(input.previousKey);
  const previous = input.previousKeyring;
  if (
    (previous as { readonly formatVersion: number }).formatVersion !== 1 ||
    requireUuid(previous.vaultId) !== input.previousKey.vaultId ||
    requireUuid(previous.vaultKeyId) !== input.previousKey.vaultKeyId
  ) {
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
  const previousRevision = requireRevision(previous.revision);
  if (previousRevision === Number.MAX_SAFE_INTEGER) {
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
  const nextSecret = sodium.randombytes_buf(previousSecret.length);
  const nextKey = createVaultHandle(sodium, input.previousKey.vaultId, randomUuid(sodium), nextSecret);
  try {
    const result = createKeyring(sodium, {
      key: nextKey,
      revision: previousRevision + 1,
      recipients: input.recipients,
    });
    return { key: nextKey, migrationRequired: true, ...result };
  } catch (error) {
    nextKey.destroy();
    throw error;
  }
}
