# `@umn-gopher-assistant/crypto`

Browser-friendly end-to-end encryption for the personal vault. The package uses the
`libsodium-wrappers-sumo` 0.8.4 ESM build and initializes it once through
`createVaultCrypto()`.

## Security properties

- Vault payloads use XChaCha20-Poly1305-IETF with a fresh 192-bit nonce. Callers cannot
  supply the nonce, AAD, cipher suite, content type, or padding scheme.
- Payload metadata is canonically encoded and authenticated. Plaintext is padded with
  `sodium_pad` to a 4 KiB boundary before encryption; the supported padded payload limit
  is 8 MiB.
- Device keys use X25519. Public-key fingerprints are BLAKE2b-256 over the domain prefix
  `UGA1/DEVICE-PUBLIC-KEY/FINGERPRINT\0` followed by the 32-byte public key.
  Fingerprints received over the wire are always recomputed, and low-order X25519 public
  keys are rejected before wrapping.
- A device envelope contains a 32-byte vault key and a 32-byte keyed metadata-binding
  tag. X25519/XChaCha20-Poly1305 adds a 16-byte authenticator, producing the contract's
  exact 80-byte `wrappedKey`.
- Recovery codes contain 160 random bits encoded as 32 Crockford Base32 symbols. Argon2id
  v1.3 uses three passes and 256 MiB. Untrusted KDF limits are checked before decoding or
  allocating, and hostile parameters, wrong codes, and tampering all return the same
  `AUTHENTICATION_FAILED` result.
- Secret handles are opaque and never export raw key bytes. `destroy()` is idempotent and
  memzeros the owned bytes. Secret-bearing temporary arrays are memzeroed in `finally`
  blocks.

For browser-local trusted-device persistence, import the reviewed API only from
`@umn-gopher-assistant/crypto/browser`. It seals/restores opaque device handles with a
non-extractable AES-256-GCM `CryptoKey`; it does not export device-private-key bytes.
Persist that `CryptoKey` with IndexedDB structured cloning, never as JWK or raw bytes.

## Minimal use

```ts
import { createVaultCrypto } from "@umn-gopher-assistant/crypto";

const crypto = await createVaultCrypto();
const vaultKey = crypto.generateVaultKey({ vaultId });
const deviceKey = crypto.generateDeviceKey({ deviceId });

const wrapped = crypto.wrapVaultKeyForDevice({
  key: vaultKey,
  recipient: deviceKey.publicKey,
});

const envelope = crypto.encryptPayload({
  key: vaultKey,
  plaintext: new TextEncoder().encode(JSON.stringify(personalData)),
  revision: 1,
  baseRevision: null,
});

const restoredVaultKey = crypto.unwrapVaultKeyForDevice({
  deviceKey,
  envelope: wrapped,
});
const plaintext = crypto.decryptPayload({ key: restoredVaultKey, envelope });

restoredVaultKey.destroy();
deviceKey.destroy();
vaultKey.destroy();
```

## Rotation

`rotateKeyring()` prepares a new key and keyring and returns
`migrationRequired: true`; it does not claim that existing records have moved. Migrate
each record with `reencryptPayloadForRotation()`, persist the new payloads and keyring
atomically, verify the durable write, and only then destroy the previous key. Revoked or
duplicate recipient device keys are rejected.

The crypto layer does not resolve sync conflicts. A caller must compare the authenticated
contiguous `baseRevision`/`revision` chain before accepting a write.

## Errors

`VaultCryptoError` exposes stable codes and fixed redacted messages. Authentication paths
do not attach the underlying exception or echo caller-controlled input. Format and
resource failures are intentionally bounded before expensive cryptographic work.
