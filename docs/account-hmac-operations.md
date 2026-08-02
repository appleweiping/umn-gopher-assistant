# Account identity HMAC continuity

The Core API pseudonymizes each verified OIDC issuer/subject pair before it is
stored. `API_ACCOUNT_SUBJECT_HMAC_KEY` is therefore durable identity data, not a
replaceable cache secret. Losing it or changing it under the same version would
otherwise make an existing person look like a first-time account.

Before the HTTP listener opens, every PostgreSQL-backed API replica calls
`public.assert_account_hmac_key_continuity(...)`. The database stores only a
domain-separated SHA-256 fingerprint in `account_hmac_key_registry`; it never
stores the key, issuer, subject, email, or another login claim. A fingerprint
mismatch, skipped version, retired version, incomplete migration, or unavailable
database aborts startup.

## Required configuration

Production requires both:

```text
API_ACCOUNT_HMAC_KEY_VERSION=<integer from 1 through 32767>
API_ACCOUNT_SUBJECT_HMAC_KEY=<canonical base64url encoding of 32 through 64 random bytes>
```

Generate and retain the key in the production secret manager. Back it up under
the same recovery policy as the personal database. Never reuse a cursor,
quota, DPoP, cookie, or service-authentication key.

`API_ACCOUNT_HMAC_ALLOW_EXISTING_BOOTSTRAP=true` is a migration-only escape
hatch. `API_ACCOUNT_HMAC_ROTATION_FINALIZED=true` is the steady state after a
non-initial rotation has been finalized. Both settings accept only the literal
values `true` and `false`.

## First continuity-sentinel rollout over existing accounts

A new empty database registers its first configured key automatically. If
`account_identity_keys` already contains rows while the continuity registry is
empty, startup fails. This prevents an accidental key from silently becoming
trusted during an upgrade.

For the one-time upgrade:

1. Verify the currently deployed key from the secret manager and take a
   coordinated database/key backup.
2. Apply migration `0004_account_hmac_continuity` while existing replicas still
   use that known-good key.
3. Start a single canary replica with its explicit current version and
   `API_ACCOUNT_HMAC_ALLOW_EXISTING_BOOTSTRAP=true`. Do not change the key in
   this release.
4. Confirm the canary initialized successfully, remove the bootstrap flag, and
   roll out the remaining replicas. Leaving the flag enabled weakens disaster
   recovery if the registry is later lost.
5. Verify with the migration-owner account that the registry contains the
   expected version and a 32-byte fingerprint. Runtime roles intentionally
   have no direct table access.

There is no safe automated way to identify a lost historical HMAC key from
opaque existing digests. If the known-good key cannot be established, stop the
rollout and treat it as an identity-continuity incident.

## Online rotation

Rotate only one version at a time. During migration configure every replica
with:

```text
API_ACCOUNT_HMAC_KEY_VERSION=<N>
API_ACCOUNT_SUBJECT_HMAC_KEY=<new key N>
API_PREVIOUS_ACCOUNT_HMAC_KEY_VERSION=<N-1>
API_PREVIOUS_ACCOUNT_SUBJECT_HMAC_KEY=<key N-1>
API_ACCOUNT_HMAC_ROTATION_FINALIZED=false
```

The startup assertion registers `N` only when `N-1` is active and its
fingerprint matches. Each subsequent login resolves through the previous digest
and atomically adds the current mapping to the same account and owner binding.
Monitor completion with a privileged, read-only operational query:

```sql
SELECT count(*) AS accounts_without_current_mapping
FROM accounts AS account
WHERE NOT EXISTS (
  SELECT 1
  FROM account_identity_keys AS identity_key
  WHERE identity_key.account_id = account.id
    AND identity_key.hmac_key_version = <N>
    AND identity_key.retired_at IS NULL
);
```

Do not finalize while the result is nonzero. Dormant accounts must migrate or
the previous key must remain available; never delete identity rows ad hoc to
force the counter to zero.

After the result reaches zero, remove both previous-key settings and set
`API_ACCOUNT_HMAC_ROTATION_FINALIZED=true`. Startup rechecks every account in a
serialized database transaction and retires all older identity mappings and
registry entries. It fails without changing state if even one account is
unmigrated. The current version remains active and can later become the
previous version for rotation `N+1`.

The database rejects registration of `N+1` until that finalization has
completed. It independently verifies that every account still has an active
mapping for `N` and that no registry entry or identity mapping older than `N`
remains active. This is a database-enforced deployment barrier, not an
operator-only sequencing rule: skipping finalization cannot silently turn a
dormant account into a new owner binding.

Rollback to the previous registered version is possible only before
finalization. A retired version fails startup. Never decrement a version to
hide a deployment problem or reuse a version with different key material.

## Restore and incident checks

Restore `account_hmac_key_registry`, `account_identity_keys`, and `accounts`
from the same database recovery point, then supply the matching secret-manager
key versions before enabling traffic. Validate the registry through the
migration owner and let the API startup assertion run before declaring the
restore healthy. Never set the existing-data bootstrap flag merely to make a
failed restore start; investigate missing registry state, wrong secrets, and
wrong database targets first.
