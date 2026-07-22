# ADR 0003: Browser vault worker and trusted-device storage

- **Status:** Accepted
- **Date:** 2026-07-20
- **Deciders:** UMN Gopher Assistant maintainers
- **Decision scope:** Browser persistence and lifecycle of the personal E2EE vault

## Context

The personal vault must work offline and across browser restarts without placing
plaintext tasks, a vault root key, or an X25519 device private key in
`localStorage`. The UI must still render decrypted task data, support recovery,
and migrate the earlier `uga.tasks` demonstration safely. Browser JavaScript
cannot guarantee secure erasure, and a same-origin script injection can ask an
unlocked origin to perform cryptographic operations even when a key is marked
non-extractable.

## Decision

Use a dedicated module worker for cryptographic state and IndexedDB for
versioned ciphertext records. The worker owns all live vault and device key
handles, canonical serialization, encryption, decryption, recovery, and key
rotation. The main thread receives only the minimum decrypted view models that
must be rendered while the vault is unlocked; it never receives raw key bytes.

The browser persistence boundary has these rules:

- persist payload envelopes, keyrings, public device descriptors, tombstones,
  and synchronization metadata only after strict schema validation;
- persist the local X25519 private key only in a versioned authenticated local
  envelope produced and consumed inside the crypto package;
- encrypt that local envelope with an origin-bound AES-256-GCM `CryptoKey`
  generated with `extractable: false` and `encrypt`/`decrypt` usages;
- store the `CryptoKey` itself through IndexedDB structured serialization, never
  JWK or raw export, and verify its algorithm, size, extractability, and usages
  every time it is loaded;
- bind the local envelope to the device ID, device-key ID, verified public-key
  fingerprint, format version, and cipher suite with canonical additional data;
- use a fresh 96-bit AES-GCM IV for every local envelope and reject unknown
  fields, algorithms, malformed lengths, public/private mismatches, and
  authentication failures before constructing a device handle;
- keep the recovery code outside browser persistence. Show it once during
  setup or rotation, require an explicit acknowledgement, and allow recovery by
  user entry only;
- require an explicit user action to unlock a trusted browser. Idle lock
  clears decrypted React state immediately, queues a worker lock behind any
  in-flight write, then terminates the worker after acknowledgement or a
  bounded timeout;
- treat the service worker, analytics, logs, crash reports, cloud AI, and API as
  ciphertext-only consumers;
- use sequential compare-and-swap revisions. An update from revision `n` must
  name `n` as its base and produce `n + 1`; conflicts retain both encrypted
  candidates until an unlocked client performs a deterministic record merge;
- represent deletion as a versioned tombstone until synchronization and the
  retention policy allow compaction.

### Legacy task migration

The one-time migration from `localStorage["uga.tasks"]` is an ordered,
recoverable transaction:

1. Read the legacy value without modifying it and validate a bounded task
   schema; invalid data is quarantined for user-directed deletion and is never
   cast to a trusted task type.
2. Set up or unlock the vault, encrypt the validated tasks in the worker, and
   commit the key material, keyring, and payload in one IndexedDB transaction.
3. Read the committed records back, validate them, and decrypt them through the
   worker.
4. Remove `uga.tasks` only after the read-back result exactly matches the
   normalized migration input. A failure leaves the legacy value intact and
   rolls back or marks the incomplete vault record for safe retry.

## Security boundary

A non-extractable `CryptoKey` reduces exposure from a copied IndexedDB database;
it is not a hardware-key guarantee, user authentication mechanism, or defense
against same-origin XSS. A malicious script running in the application origin
can invoke the same permitted cryptographic operations or copy decrypted UI
data. Content Security Policy, Trusted Types, dependency review, minimal worker
messages, visible lock state, and fast security patching remain mandatory.

Clearing origin storage destroys the trusted-device key and may make local data
unrecoverable without the separately saved recovery code. The setup and delete
flows must state this plainly in both supported languages.

## Alternatives considered

### Store the device private key as a raw IndexedDB byte array

- **Pros:** Small implementation and automatic restart.
- **Cons:** A profile or database copy directly exposes the long-lived device
  key.
- **Why not:** It violates the project's key-at-rest boundary.

### Require the recovery code after every browser restart

- **Pros:** No trusted-device secret needs local persistence.
- **Cons:** Poor usability encourages unsafe recovery-code storage and makes
  ordinary offline use impractical.
- **Why not:** Recovery remains an exceptional path, not the daily unlock path.

### Perform cryptography in React components

- **Pros:** Fewer modules and easier state access.
- **Cons:** Key lifetime follows the full page graph, accidental logging and
  serialization are easier, and idle termination cannot provide a narrow
  cleanup boundary.
- **Why not:** A dedicated worker provides a smaller auditable protocol and a
  concrete lifecycle boundary.

## Consequences

- Personal tools remain usable offline and after restart on a trusted browser.
- The application needs explicit worker RPC, IndexedDB migrations, transaction
  recovery, lock-state UI, and browser-compatibility tests.
- Rendering plaintext still places it in page memory and the accessibility
  tree while unlocked; the UI must clear it on lock without making personal
  tasks inaccessible to assistive technology during normal use.
- Browsers that cannot persist a non-extractable `CryptoKey` or provide the
  required Worker, WebCrypto, and IndexedDB primitives run personal tools in a
  clearly labeled unavailable/read-only mode rather than weakening storage.
- Safari/iOS releases before 26 also run the vault in unavailable mode. WebKit
  bug 288682 allowed a Worker termination to commit a partially scheduled
  IndexedDB transaction; the upstream fix was absent from Apple's Safari 18.6
  source and present in Safari 26. Public, non-vault routes remain supported.
