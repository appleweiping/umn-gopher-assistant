import type { AuthorizationKeyHandle, DevicePublicKeyV1, DeviceKeyHandle, VaultKeyHandle } from "../types.js";
import type { Sodium } from "./sodium.js";

import { AUTHORIZATION_PRIVATE_KEY_BYTES, DEVICE_KEY_BYTES, VAULT_KEY_BYTES } from "../constants.js";
import { cryptoError, VaultCryptoErrorCode } from "../errors.js";

interface VaultKeyState {
  readonly memzero: (value: Uint8Array) => void;
  readonly vaultId: string;
  readonly vaultKeyId: string;
  secret: Uint8Array | undefined;
}

interface DeviceKeyState {
  readonly memzero: (value: Uint8Array) => void;
  readonly publicKey: DevicePublicKeyV1;
  privateKey: Uint8Array | undefined;
}

export interface AuthorizationKeyMetadata {
  readonly kind: "DEVICE" | "RECOVERY";
  readonly ownerBinding: string;
  readonly deviceId: string | null;
  readonly vaultId: string | null;
  readonly keyId: string;
  readonly publicKey: string;
  readonly fingerprint: string;
  readonly createdAt: string;
}

interface AuthorizationKeyState extends AuthorizationKeyMetadata {
  readonly memzero: (value: Uint8Array) => void;
  privateKey: Uint8Array | undefined;
}

// The byte arrays deliberately live outside the public object graph. TypeScript
// `private` and branded interfaces disappear at runtime and therefore are not
// security boundaries. Module-private WeakMaps let package internals use the
// bytes without publishing a callable getter on a handle or its prototype.
const vaultKeyStates = new WeakMap<object, VaultKeyState>();
const deviceKeyStates = new WeakMap<object, DeviceKeyState>();
const authorizationKeyStates = new WeakMap<object, AuthorizationKeyState>();
const handleConstructionCapability = Symbol("uga.vault-handle-construction");

function vaultState(handle: object): VaultKeyState {
  const state = vaultKeyStates.get(handle);
  if (state === undefined) throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  return state;
}

function deviceState(handle: object): DeviceKeyState {
  const state = deviceKeyStates.get(handle);
  if (state === undefined) throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  return state;
}

function authorizationState(handle: object): AuthorizationKeyState {
  const state = authorizationKeyStates.get(handle);
  if (state === undefined) throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  return state;
}

class VaultKeyHandleImpl {
  constructor(capability: symbol, sodium: Sodium, vaultId: string, vaultKeyId: string, secret: Uint8Array) {
    if (capability !== handleConstructionCapability) {
      throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
    }
    if (secret.length !== VAULT_KEY_BYTES) {
      sodium.memzero(secret);
      throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
    }
    vaultKeyStates.set(this, {
      memzero: sodium.memzero.bind(sodium),
      secret,
      vaultId,
      vaultKeyId,
    });
    Object.freeze(this);
  }

  get vaultId(): string {
    return vaultState(this).vaultId;
  }

  get vaultKeyId(): string {
    return vaultState(this).vaultKeyId;
  }

  get destroyed(): boolean {
    return vaultState(this).secret === undefined;
  }

  destroy(): void {
    const state = vaultState(this);
    if (state.secret !== undefined) {
      state.memzero(state.secret);
      state.secret = undefined;
    }
  }
}

class DeviceKeyHandleImpl {
  constructor(capability: symbol, sodium: Sodium, publicKey: DevicePublicKeyV1, privateKey: Uint8Array) {
    if (capability !== handleConstructionCapability) {
      throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
    }
    if (privateKey.length !== DEVICE_KEY_BYTES) {
      sodium.memzero(privateKey);
      throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
    }
    deviceKeyStates.set(this, {
      memzero: sodium.memzero.bind(sodium),
      privateKey,
      publicKey: Object.freeze({ ...publicKey }),
    });
    Object.freeze(this);
  }

  get publicKey(): DevicePublicKeyV1 {
    return deviceState(this).publicKey;
  }

  get destroyed(): boolean {
    return deviceState(this).privateKey === undefined;
  }

  destroy(): void {
    const state = deviceState(this);
    if (state.privateKey !== undefined) {
      state.memzero(state.privateKey);
      state.privateKey = undefined;
    }
  }
}

class AuthorizationKeyHandleImpl {
  constructor(
    capability: symbol,
    sodium: Sodium,
    metadata: AuthorizationKeyMetadata,
    privateKey: Uint8Array,
  ) {
    if (capability !== handleConstructionCapability) {
      throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
    }
    if (privateKey.length !== AUTHORIZATION_PRIVATE_KEY_BYTES) {
      sodium.memzero(privateKey);
      throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
    }
    authorizationKeyStates.set(this, {
      ...metadata,
      memzero: sodium.memzero.bind(sodium),
      privateKey,
    });
    Object.freeze(this);
  }

  get kind(): "DEVICE" | "RECOVERY" {
    return authorizationState(this).kind;
  }

  get ownerBinding(): string {
    return authorizationState(this).ownerBinding;
  }

  get deviceId(): string | null {
    return authorizationState(this).deviceId;
  }

  get vaultId(): string | null {
    return authorizationState(this).vaultId;
  }

  get keyId(): string {
    return authorizationState(this).keyId;
  }

  get publicKey(): string {
    return authorizationState(this).publicKey;
  }

  get fingerprint(): string {
    return authorizationState(this).fingerprint;
  }

  get createdAt(): string {
    return authorizationState(this).createdAt;
  }

  get destroyed(): boolean {
    return authorizationState(this).privateKey === undefined;
  }

  destroy(): void {
    const state = authorizationState(this);
    if (state.privateKey !== undefined) {
      state.memzero(state.privateKey);
      state.privateKey = undefined;
    }
  }
}

// `prototype.constructor` would otherwise reveal the unexported class through
// a returned handle. The capability check remains the primary construction
// boundary; removing the reflection path is defense in depth.
Object.defineProperty(VaultKeyHandleImpl.prototype, "constructor", {
  configurable: false,
  value: undefined,
  writable: false,
});
Object.defineProperty(DeviceKeyHandleImpl.prototype, "constructor", {
  configurable: false,
  value: undefined,
  writable: false,
});
Object.defineProperty(AuthorizationKeyHandleImpl.prototype, "constructor", {
  configurable: false,
  value: undefined,
  writable: false,
});
Object.freeze(VaultKeyHandleImpl.prototype);
Object.freeze(DeviceKeyHandleImpl.prototype);
Object.freeze(AuthorizationKeyHandleImpl.prototype);

export function createVaultHandle(
  sodium: Sodium,
  vaultId: string,
  vaultKeyId: string,
  secret: Uint8Array,
): VaultKeyHandle {
  return new VaultKeyHandleImpl(
    handleConstructionCapability,
    sodium,
    vaultId,
    vaultKeyId,
    secret,
  ) as unknown as VaultKeyHandle;
}

export function createDeviceHandle(
  sodium: Sodium,
  publicKey: DevicePublicKeyV1,
  privateKey: Uint8Array,
): DeviceKeyHandle {
  return new DeviceKeyHandleImpl(
    handleConstructionCapability,
    sodium,
    publicKey,
    privateKey,
  ) as unknown as DeviceKeyHandle;
}

export function createAuthorizationHandle(
  sodium: Sodium,
  metadata: AuthorizationKeyMetadata,
  privateKey: Uint8Array,
): AuthorizationKeyHandle {
  return new AuthorizationKeyHandleImpl(
    handleConstructionCapability,
    sodium,
    Object.freeze({ ...metadata }),
    privateKey,
  ) as unknown as AuthorizationKeyHandle;
}

export function vaultSecret(handle: VaultKeyHandle): Uint8Array {
  if (!(handle instanceof VaultKeyHandleImpl)) {
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
  const secret = vaultState(handle).secret;
  if (secret === undefined) throw cryptoError(VaultCryptoErrorCode.DESTROYED_KEY);
  return secret;
}

export function devicePrivateKey(handle: DeviceKeyHandle): Uint8Array {
  if (!(handle instanceof DeviceKeyHandleImpl)) {
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
  const privateKey = deviceState(handle).privateKey;
  if (privateKey === undefined) throw cryptoError(VaultCryptoErrorCode.DESTROYED_KEY);
  return privateKey;
}

export function authorizationPrivateKey(handle: AuthorizationKeyHandle): Uint8Array {
  if (!(handle instanceof AuthorizationKeyHandleImpl)) {
    throw cryptoError(VaultCryptoErrorCode.INVALID_INPUT);
  }
  const privateKey = authorizationState(handle).privateKey;
  if (privateKey === undefined) throw cryptoError(VaultCryptoErrorCode.DESTROYED_KEY);
  return privateKey;
}
