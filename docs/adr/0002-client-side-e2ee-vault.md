# ADR 0002: Versioned client-side E2EE personal vault

- **Status:** Accepted
- **Date:** 2026-07-20
- **Deciders:** UMN Gopher Assistant maintainers
- **Decision scope:** Personal schedules, tasks, notes, and reminders

## Context

Personal planning data must remain unreadable to the API, storage operator, and
cloud AI by default while still supporting offline use, recovery, multiple
devices, conflict detection, and future key rotation. The browser platform does
not provide one portable primitive that combines a long random nonce, password
hardening, public-key device wrapping, and deterministic envelope
interoperability across all target browsers and Node.js tests.

## Decision

Use a versioned client-side vault built on a random 32-byte root key,
XChaCha20-Poly1305 payload encryption, X25519/XChaCha20-Poly1305 device
envelopes, and Argon2id13 recovery envelopes. Keep plaintext and root keys in a
dedicated client worker, persist only validated ciphertext and keyring records,
and require compare-and-swap revisions for synchronization.

The v1 protocol has these fixed properties:

- payload metadata is authenticated through a canonical, versioned AAD tuple;
- nonces and ephemeral device keys are generated internally and never accepted
  from product-layer callers;
- payloads use 4 KiB padding buckets and explicit plaintext size limits;
- every device envelope binds the vault ID, root-key ID, recipient device/key
  IDs, and recipient public-key fingerprint;
- recovery envelopes persist exact Argon2id salt, operations, and memory
  parameters and reject resource limits before allocating;
- unsupported versions, algorithms, non-canonical encodings, duplicate devices,
  and inconsistent metadata fail closed;
- removing a device envelope is not revocation of a key already learned by that
  device; a lost or compromised device requires a new root key, re-encryption,
  and new envelopes for every remaining device and the recovery code;
- cloud AI, service workers, analytics, logs, and server-side search have no
  plaintext access path.

### Canonical authenticated headers

The three v1 header domains are the ASCII strings `UGA1/PAYLOAD/AAD`,
`UGA1/RECOVERY/AAD`, and `UGA1/DEVICE-ENVELOPE/HEADER`. A header is serialized
with `JSON.stringify` as one JSON array, with the domain as element zero and no
extra whitespace. All variable strings in a validated v1 envelope are ASCII.
The resulting ASCII bytes are encoded as canonical unpadded base64url for the
public contract. Implementations MUST use the decoded ASCII bytes as the AEAD
AAD or device binding input; they MUST NOT authenticate the base64url text.

The array fields and order are normative:

1. Payload: domain, `formatVersion`, `vaultId`, `vaultKeyId`, `revision`,
   `baseRevision`, `cipherSuite`, `contentType`, `contentSchemaVersion`,
   `padding.algorithm`, `padding.blockSize`, `nonce`, `createdAt`.
2. Recovery: domain, `formatVersion`, `vaultId`, `vaultKeyId`, `cipherSuite`,
   `kdf.algorithm`, `kdf.salt`, `kdf.opsLimit`, `kdf.memLimitBytes`,
   `kdf.outputBytes`, `nonce`, `createdAt`.
3. Device envelope: domain, `formatVersion`, `vaultId`, `vaultKeyId`,
   `recipientDeviceId`, `recipientKeyId`, `recipientPublicKeyFingerprint`,
   `cipherSuite`, `ephemeralPublicKey`, `nonce`, `createdAt`.

`buildPayloadAadV1`, `buildRecoveryAadV1`, and
`buildDeviceEnvelopeHeaderV1` in the contracts package are the normative
builders and carry fixed interoperability vectors. Payload and recovery
schemas recompute the appropriate builder and require exact equality with the
stored `aad`. A changed header with an unchanged `aad` is invalid before any
decryption attempt.

### Device public keys and 80-byte envelopes

The stored device-key fingerprint is exactly:

```text
BLAKE2b-256(
  ASCII("UGA1/DEVICE-PUBLIC-KEY/FINGERPRINT\0") || rawX25519PublicKey32
)
```

It is stored as canonical unpadded base64url. This is unkeyed BLAKE2b with a
32-byte output; hashing the textual public-key encoding or omitting the domain
and NUL separator is not interoperable.

For a device envelope, decode the canonical device header to `headerBytes` and
compute:

```text
bindingTag32 = BLAKE2b-256-keyed(
  key = vaultKey32,
  message = ASCII("UGA1/DEVICE-ENVELOPE/BINDING\0") || headerBytes
)
boxPlaintext64 = vaultKey32 || bindingTag32
wrappedKey80 = crypto_box_curve25519xchacha20poly1305_easy(
  boxPlaintext64,
  nonce24,
  recipientPublicKey32,
  ephemeralSecretKey32
)
```

The `ephemeralPublicKey` is the X25519 public key corresponding to the fresh
ephemeral secret, which is erased after wrapping. The 64-byte plaintext plus
the primitive's 16-byte MAC explains the contract's exact 80-byte
`wrappedKey`. Opening uses
`crypto_box_curve25519xchacha20poly1305_open_easy`, then recomputes the keyed
tag with the recovered vault key and compares it in constant time. Failure of
either check is authentication failure.

Device public keys MUST be canonical 32-byte encodings and MUST be rejected if
the libsodium X25519/box primitive reports an invalid or low-order point. The
all-zero key and all inputs that yield an all-zero shared secret are invalid.
Pairing also recomputes the domain-separated fingerprint and compares it out
of band; schema length checks alone are not curve validation.

### Revisions and keyring compare-and-swap

Payload revision 1 has `baseRevision: null`. Every later payload MUST have
`revision === baseRevision + 1`; gaps and rollback are rejected even when the
AAD is otherwise valid. A keyring create succeeds only when no current record
exists. Every keyring update supplies the last observed revision separately as
the compare value and writes exactly `revision = currentRevision + 1` in one
atomic compare-and-swap. A stale compare returns a conflict and never merges,
partially applies, or overwrites envelopes; the client refetches, decrypts,
reapplies its intent, and retries. Root-key rotation publishes the new payload
and matching keyring in one transactional operation, so readers never observe
a new `vaultKeyId` on only one side.

### Recovery code and failure behavior

A UGA1 recovery secret is exactly 160 uniformly random bits from the operating
system CSPRNG. Interpret the 20 bytes as one big-endian bit string and encode
its 32 five-bit groups with uppercase Crockford Base32 alphabet
`0123456789ABCDEFGHJKMNPQRSTVWXYZ`. The display form is `UGA1-` followed by
eight groups of four symbols separated by ASCII hyphens, for example
`UGA1-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`.

Input normalization is exact: apply Unicode NFKC, remove only ASCII hyphen and
ASCII space, tab, CR, and LF, uppercase ASCII letters, require the `UGA1`
prefix plus exactly 32 symbols, map `O` to `0` and `I` or `L` to `1`, and reject
every other non-alphabet character (including `U`). Decode to the original 20
bytes and pass those raw bytes—not the display text—to Argon2id13. The envelope
salt, operations, memory bytes, and 32-byte output length are authenticated by
the recovery AAD. Limits are checked before allocating Argon2 memory.

Recovery-code rotation generates a new independent 160-bit code, salt, and
nonce, rewraps the same vault key, removes the previous recovery envelope, and
publishes the next keyring revision through CAS. Once committed, the old code
is not accepted by current state. If the old code may be compromised, merely
rewrapping is not revocation from backups: rotate the vault key and re-encrypt
the payload and all remaining device and recovery envelopes atomically.

All externally visible recovery-unlock failures are the single stable error
`AUTHENTICATION_FAILED`, including malformed codes, invalid envelopes,
unsupported versions, hostile or out-of-range KDF metadata, public-key or
fingerprint failures, and AEAD/tag failures. Implementations may record a
non-secret internal reason, but MUST NOT return distinct status, text, or
machine-readable causes that create an oracle. Resource limits are still
rejected before allocation; uniform errors do not require performing hostile
work or guaranteeing identical timing.

## Alternatives considered

### Server-side envelope encryption only

- **Pros:** Simple synchronization, search, recovery, and moderation tooling.
- **Cons:** The service or KMS can decrypt all personal records and cloud AI can
  accidentally receive them.
- **Why not:** It does not satisfy the default server-blind privacy boundary.

### WebCrypto AES-GCM for every layer

- **Pros:** Native browser API, non-extractable local wrapping keys, and no
  additional WASM dependency.
- **Cons:** A 96-bit nonce requires stricter coordination, browser support for
  Argon2id and X25519 is not sufficiently uniform, and the required protocol
  would diverge across runtimes.
- **Why not:** The project requires one interoperable suite with password
  recovery and multi-device public-key wrapping.

### Encrypt each task as an independent server-searchable record

- **Pros:** Smaller conflict units and selective synchronization.
- **Cons:** More observable metadata, more nonce/key lifecycle surface, and no
  meaningful server-side search without leaking indexes or plaintext.
- **Why not:** The initial vault favors a smaller audited protocol and performs
  record-level merge only after client-side decryption.

## Consequences

### Positive

- A database, object-store, backup, or cloud-model compromise does not disclose
  default personal plaintext without a client key.
- Versioned schemas, fixed algorithms, and test vectors make downgrade and
  cross-runtime drift detectable.
- Device loss, recovery, and rotation have explicit workflows instead of
  relying on account-password resets.

### Negative

- Lost recovery material can make data permanently unrecoverable.
- Argon2id consumes at least 64 MiB and can fail on constrained devices; the
  client must report that failure and must not silently weaken parameters.
- The server still observes ciphertext size buckets, device count, access
  timing, revision count, and account metadata.
- Server-side search and cloud AI cannot inspect personal data by default.

### Risks

- JavaScript, strings, garbage collection, and WASM copies prevent a guarantee
  that every key byte is erased; implementations use mutable byte arrays,
  minimize copies, terminate workers on lock, and call sodium memory clearing
  as best effort.
- Same-origin XSS can message an unlocked worker; CSP, Trusted Types, dependency
  review, short idle locking, and a narrow worker protocol remain required.
- A malicious server can substitute a new device public key; device pairing
  must compare a fingerprint/SAS or QR code out of band before sharing the root
  key.
- Protocol mistakes can defeat sound primitives; v1 requires independent
  review, fixed interoperability vectors, and fail-closed parsing before public
  release.
