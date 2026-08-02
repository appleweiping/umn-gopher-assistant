# ADR 0007: Account-bound, authorized E2EE vault synchronization

- **Status:** Accepted
- **Date:** 2026-07-22
- **Deciders:** UMN Gopher Assistant maintainers
- **Decision scope:** Personal-vault synchronization, device pairing, and recovery authorization

## Context

The v1 vault protects personal plaintext and root keys, but its records are not
cryptographically bound to an authenticated account and its revision numbers
alone do not prove who authorized a remote write. A storage service that can
replace public device descriptors could otherwise introduce a device, swap
ciphertext between accounts, or invent a new state transition. A browser also
needs to authorize reads and writes after restart without exporting another
long-lived private key.

## Decision

Keep every v1 wire type and operation intact for local/offline compatibility,
and add a separate v2 synchronization protocol. V2 has the following
independent bindings:

- `ownerBinding` is an opaque, canonical 32-byte account binding supplied and
  checked by the authenticated account boundary. It is included in payload AAD,
  authorization descriptors, manifests, commits, commands, read proofs, and
  pairing requests.
- Every active `DeviceDescriptorV2` must contain both an X25519 encryption key
  and an Ed25519 authorization key. Encryption and authorization key IDs are
  distinct.
- The browser derives the Ed25519 device seed inside the crypto package as a
  keyed, domain-separated BLAKE2b-256 KDF over the persisted X25519 private
  scalar, owner binding, device ID, and authorization key ID. The X25519 key is
  already stored only in the authenticated local envelope protected by a
  non-extractable AES-256-GCM `CryptoKey` described in ADR 0003. Reloading that
  envelope derives the same authorization public key; neither private key has
  an export operation.
- The 160-bit random recovery code deterministically derives a separate
  Ed25519 recovery-authorization seed with its own domain, owner binding, and
  vault ID. The current public key is explicit in the authorization manifest.
- `AuthorizationManifestV2` is strict, owner/vault bound, versioned by epoch and
  revision, and retains at least one active device plus one current recovery
  authorization key.
- Every state transition produces a linear `VaultCommitV2`. The canonical
  commit body includes epoch, sequence, parent commit hash, payload hash,
  keyring hash, authorization-manifest hash, operation ID, author, and time.
  An authorized Ed25519 key signs that body and the vault root key computes a
  separate keyed BLAKE2b-256 state MAC over a distinct domain. Only epoch 1,
  sequence 1 has a null parent.
- Create, payload-update, pairing, and rotation commands carry a short-lived,
  signed command proof that binds the expected parent and next commit hash.
  Read proofs use a fresh 32-byte nonce, a maximum two-minute lifetime, and a
  replay cache through expiry. Pairing requests are self-signed by the proposed
  device and bind the out-of-band code commitment; an already authorized
  device or recovery key separately approves the resulting state transition.

All schemas reject unknown fields and non-canonical UUIDs, timestamps, or
base64url. Normative tuple builders return canonical unpadded base64url of the
ASCII `JSON.stringify` array. Implementations sign or MAC the decoded tuple
bytes, never the textual base64url. Complete state artifacts are parsed by
their strict schema, serialized in schema property order with `JSON.stringify`,
then hashed with BLAKE2b-256 over the following NUL-terminated domain prefix
and UTF-8 JSON:

| Artifact                                        | Domain                               |
| ----------------------------------------------- | ------------------------------------ |
| V2 payload                                      | `UGA2/PAYLOAD/HASH\0`                |
| V1 keyring carried by a V2 snapshot             | `UGA2/KEYRING/HASH\0`                |
| V2 authorization manifest                       | `UGA2/AUTHORIZATION-MANIFEST/HASH\0` |
| Complete V2 commit, including MAC and signature | `UGA2/VAULT-COMMIT/HASH\0`           |

Ed25519 public-key fingerprints are
`BLAKE2b-256("UGA2/AUTHORIZATION-PUBLIC-KEY/FINGERPRINT\0" || rawPublicKey32)`.
X25519 fingerprints retain the reviewed v1 domain from ADR 0002. Fixed vectors
cover every tuple, fingerprint, recovery derivation, signature, state MAC, and
commit hash.

### Client state machine and recovery hardening

The browser treats local persistence as a write-ahead protocol state machine,
not as a cache of the last HTTP response. Genesis, payload mutation, pairing,
and rotation persist the exact command and successor state in one IndexedDB
transaction before the first network attempt. Retries reuse the same complete
command while its short-lived proof remains valid. If that proof expires, the
client first performs a fresh authorized read; only an exact staged successor
may be committed, or an exact unchanged parent may authorize an atomic
proof-only renewal. The operation ID, idempotency key, parent, encrypted
snapshot, commit and audit intent never change. A response is accepted only
when its complete snapshot and quoted ETag match the staged commit hash. This
makes a process exit, page refresh, expired proof, or lost response recoverable
without constructing a second transition or blindly overwriting a newer head.

A device with no local vault starts remote recovery only after fetching the
account-bound public recovery descriptor and locally deriving an exact matching
recovery fingerprint. A wrong code causes no recovery read, pairing mutation,
or local vault write. A correct code authorizes a fresh signed read, complete
snapshot verification and decryption, and a self-signed replacement-device
pairing. Local state then advances through these fail-closed phases:

1. `pairing-pending`: the exact create and recovery-approval intents are durable
   and replayable, but ordinary vault operations remain unavailable;
2. `hardening-required`: the replacement device is authoritative, but ordinary
   writes remain disabled until all prior device and recovery authority is
   removed;
3. `rotation-pending`: a confirmed new root, recovery descriptor, replacement
   envelope, and exact rotation command are durable; the newly displayed
   recovery code is no longer retained or redisplayed; and
4. normal synchronized operation only after a fresh replacement-device-signed
   read returns the exact rotated head and all component checks pass.

Rotation increments the authorization epoch, revokes every previously active
device except the replacement, replaces the keyring with a replacement-only
envelope, and changes both the vault root and recovery authorization key. The
new recovery code exists only in Worker memory until the user acknowledges
offline storage. No rotation request is sent before that acknowledgement.

An HTTP `403`, `409`, `412`, or `422` from a durable command never triggers a
blind overwrite or unconditional re-sign. The client first performs an
independent signed read. If the staged next snapshot is already the current
head, it verifies that exact snapshot under the correct root and completes the
read-back gate; this also recovers when the server's minimum 24-hour idempotency
record has expired after a successfully applied command. If the exact trusted
parent is still current, an expired proof may be renewed atomically while every
business field remains unchanged. A `409` is inspected for an already-applied
head but is never proof-renewed because it can mean the operation ID is bound to
a different digest.

A rebase is allowed only for a fully authenticated, directly linked
payload-only child under the old root: its parent hash, next sequence, payload
base/revision, keyring and authorization manifest must all match exactly. A
larger sequence alone does not prove ancestry. Multi-hop or forked heads require
a separately verified commit chain and currently fail closed. Any
authorization, epoch, root, keyring, manifest, rollback, ancestry, or signature
change fails closed.

An abandoned pre-approval `pairing-pending` attempt may be cancelled and
restarted without deleting a committed vault. A `rotation-pending` attempt is
never discarded as a generic reset because its transition may already be
authoritative remotely.

Server maintenance expires overdue pending pairings, retains terminal pairing
records for 30 days, and retains completed command results for at least 24
hours. Pending commands and authoritative vault artifacts are never deleted by
that maintenance path. The client recovery rules above deliberately do not
assume an idempotency result remains after the minimum window.

## Security boundary

The protocol prevents the API, database, object store, or a passive backup
operator from decrypting personal data or fabricating an accepted new vault
state without an authorized signing key and the root-key MAC. Owner binding
prevents a valid artifact from one account being accepted as another account's
state. Signatures, MACs, strict component hashes, operation IDs, parent hashes,
expiry, and nonce replay caches detect substitution, unauthorized writes, and
protocol replay.

A malicious storage server can still withhold availability and can replay a
previously valid complete snapshot to a client that has no newer trusted local
anchor. Clients retain their latest commit anchor and warn on rollback; global
fork consistency or transparency logging is a separate future decision.

An ordinary Web/PWA asset server is **not** inside the malicious-server
protection claim. A compromised asset origin, same-origin XSS, malicious
service worker, browser extension, or compromised endpoint can serve code that
invokes an unlocked handle, reads rendered plaintext, or exfiltrates a recovery
code. CSP, Trusted Types, dependency integrity, service-worker update controls,
short unlock lifetimes, and rapid patching remain required. “Non-extractable”
is an API boundary and at-rest protection, not a hardware enclave guarantee.

## Consequences

### Positive

- Remote state has explicit account, author, parent, component, and root-key
  integrity instead of relying on server-side revision checks.
- Trusted browsers can restart and sign again without exporting or separately
  persisting an Ed25519 private key.
- Recovery proves possession independently of the account session and can
  authorize device replacement without disclosing the recovery code.
- Shared browser-compatible contracts keep the API, worker, SDK, and tests on
  one canonical byte representation.

### Negative

- Every mutation must build and verify multiple strict artifacts and maintain a
  nonce/operation replay store.
- Device authorization rotates with the underlying device key or key ID, and a
  compromised trusted device can authorize writes until its descriptor and
  root key are rotated.
- Fresh clients need a trusted anchor or an additional transparency mechanism
  to distinguish the latest valid state from a valid historical replay.
