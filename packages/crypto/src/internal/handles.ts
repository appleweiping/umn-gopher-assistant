import type { DevicePublicKeyV1, DeviceKeyHandle, VaultKeyHandle } from "../types.js";
import type { Sodium } from "./sodium.js";

import { DEVICE_KEY_BYTES, VAULT_KEY_BYTES } from "../constants.js";
import { cryptoError, VaultCryptoErrorCode } from "../errors.js";

class VaultKeyHandleImpl {
  #secret: Uint8Array | undefined;
  readonly vaultId: string;
  readonly vaultKeyId: string;

  constructor(
    private readonly sodium: Sodium,
    vaultId: string,
    vaultKeyId: string,
    secret: Uint8Array,
  ) {
    if (secret.length !== VAULT_KEY_BYTES) {
      sodium.memzero(secret);
      throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
    }
    this.vaultId = vaultId;
    this.vaultKeyId = vaultKeyId;
    this.#secret = secret;
  }

  get destroyed(): boolean {
    return this.#secret === undefined;
  }

  destroy(): void {
    if (this.#secret !== undefined) {
      this.sodium.memzero(this.#secret);
      this.#secret = undefined;
    }
  }

  secret(): Uint8Array {
    if (this.#secret === undefined) {
      throw cryptoError(VaultCryptoErrorCode.DESTROYED_KEY);
    }
    return this.#secret;
  }
}

class DeviceKeyHandleImpl {
  #privateKey: Uint8Array | undefined;
  readonly publicKey: DevicePublicKeyV1;

  constructor(
    private readonly sodium: Sodium,
    publicKey: DevicePublicKeyV1,
    privateKey: Uint8Array,
  ) {
    if (privateKey.length !== DEVICE_KEY_BYTES) {
      sodium.memzero(privateKey);
      throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
    }
    this.publicKey = Object.freeze({ ...publicKey });
    this.#privateKey = privateKey;
  }

  get destroyed(): boolean {
    return this.#privateKey === undefined;
  }

  destroy(): void {
    if (this.#privateKey !== undefined) {
      this.sodium.memzero(this.#privateKey);
      this.#privateKey = undefined;
    }
  }

  privateKey(): Uint8Array {
    if (this.#privateKey === undefined) {
      throw cryptoError(VaultCryptoErrorCode.DESTROYED_KEY);
    }
    return this.#privateKey;
  }
}

export function createVaultHandle(
  sodium: Sodium,
  vaultId: string,
  vaultKeyId: string,
  secret: Uint8Array,
): VaultKeyHandle {
  return new VaultKeyHandleImpl(sodium, vaultId, vaultKeyId, secret) as unknown as VaultKeyHandle;
}

export function createDeviceHandle(
  sodium: Sodium,
  publicKey: DevicePublicKeyV1,
  privateKey: Uint8Array,
): DeviceKeyHandle {
  return new DeviceKeyHandleImpl(sodium, publicKey, privateKey) as unknown as DeviceKeyHandle;
}

export function vaultSecret(handle: VaultKeyHandle): Uint8Array {
  if (!(handle instanceof VaultKeyHandleImpl)) {
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
  return handle.secret();
}

export function devicePrivateKey(handle: DeviceKeyHandle): Uint8Array {
  if (!(handle instanceof DeviceKeyHandleImpl)) {
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
  return handle.privateKey();
}
