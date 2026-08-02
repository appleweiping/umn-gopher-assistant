# Personal-vault ephemeral retention

This runbook covers only the bounded lifecycle of the account-bound encrypted
vault's idempotency results and device-pairing records. Payloads, keyrings,
manifests, commits, and device history are deliberately outside this job.

## Retention contract

| Record                                                        | Maintenance behavior                                                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Completed `succeeded` or `failed` command result              | Eligible for deletion only after `completed_at` is at least 24 hours old                              |
| `pending` command                                             | Never deleted by this job; commands at least 24 hours old are counted for reconciliation and alerting |
| Expired `pending` pairing                                     | Atomically moved to `expired`; `updated_at` records the terminal transition                           |
| `consumed`, `expired`, or `cancelled` pairing                 | Eligible for deletion only after `updated_at` is at least 30 days old                                 |
| Payload, keyring, manifest, commit, device, vault, or account | Never updated or deleted by this job                                                                  |

The fixed 24-hour command window is the minimum replay period promised by the
API contract. Operators may delay a run, but must not shorten the cutoff by
editing the migration or invoking ad hoc SQL. An old `pending` command may
represent an interrupted transaction or defect; silent deletion could allow the
same idempotency key to execute again, so it requires application-level
reconciliation.

## Authority boundary

`public.maintain_personal_vault_ephemera(boolean, integer)` is the only
supported database entry point. It is a fixed-search-path `SECURITY DEFINER`
function, sets `row_security=off` so an incorrectly provisioned definer fails
closed instead of silently processing one tenant, validates a batch size from 1
through 5,000, and has all `PUBLIC` privileges revoked. The personal API role
must never receive `EXECUTE`.

Provision a dedicated scheduler login with only `CONNECT`, schema `USAGE`, and
`EXECUTE` on this exact signature. Do not grant it table privileges, role
membership, `BYPASSRLS`, or ownership. The function owner must be the reviewed
migration/maintenance definer that can operate across forced RLS; production
provisioning must verify this after every restore:

```sql
SELECT
  p.prosecdef,
  p.proconfig,
  pg_get_userbyid(p.proowner) AS owner,
  EXISTS (
    SELECT 1
    FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS privilege
    WHERE privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ) AS public_can_execute
FROM pg_proc AS p
WHERE p.oid =
  'public.maintain_personal_vault_ephemera(boolean,integer)'::regprocedure;
```

Expected: `prosecdef=true`, configuration includes
`search_path=pg_catalog, pg_temp` and `row_security=off`, and
`public_can_execute=false`.

Set the scheduler secret only in its secret manager:

```text
PERSONAL_VAULT_MAINTENANCE_DATABASE_URL=postgresql://<dedicated-runner>:<secret>@<host>/<database>?sslmode=verify-full
```

The CLI has no default URL and never falls back to the API or development
identity. Every non-loopback hostname must use exactly one
`sslmode=verify-full`; `require`, `verify-ca`, a missing mode, and duplicate
parameters fail before a connection is attempted. An explicit loopback host
(`localhost`, `127.0.0.0/8`, or `::1`) may omit TLS for local development.
Configuration and connection failures never echo the URL or decoded password.
Run `pnpm maintain:personal-vault --check-configuration` as a deployment
preflight; it validates the URL policy without opening a database connection
and emits only the transport classification, never the URL.

## Preview and apply

Preview is the default and performs no update, delete, or audit insert:

```bash
pnpm maintain:personal-vault --dry-run --batch-size 500
```

Apply requires both the mutation flag and the literal confirmation:

```bash
pnpm maintain:personal-vault --apply \
  --confirm APPLY_PERSONAL_VAULT_EPHEMERA_RETENTION \
  --batch-size 500
```

Every invocation emits one JSON line. Counts ending in `Eligible` describe the
bounded candidate set seen by that call; counts ending in `Expired` or
`Deleted` are committed mutations. `*Remaining=true` means another batch is
needed. `stalePendingCommandsObserved` is an alert, not a deletion count.

Each apply call is one database transaction. Candidate rows are ordered, capped
by the requested batch size independently for each of the three mutation
classes, and locked with `FOR UPDATE SKIP LOCKED`, so multiple schedulers can
share work without waiting on or deleting the same row. A `*Remaining` flag can
be conservatively true while another worker holds an uncommitted candidate; an
extra no-op pass is safe. An apply batch also inserts one anonymous
`personal_vault.ephemera.maintain` audit event containing its run UUID, session
role, cutoffs, counts, and remaining-work flags. If that audit insert fails, the
entire cleanup batch rolls back.

## Schedule, monitoring, and incident response

Run hourly with a normal batch of 500. A scheduler may issue further apply calls
while any deletion/expiry `*Remaining` flag is true, but should cap a single
cycle (for example, 20 calls) to protect database latency. Alert on:

- stale pending commands observed in two consecutive runs;
- any job failure or missing hourly success event;
- a backlog that remains after the per-cycle cap;
- unexpected growth in terminal pairings or completed commands;
- any grant of this function to the API role or `PUBLIC`.

Investigate stale pending commands against request traces and the durable
command state machine. Resolve them through a reviewed application
reconciliation procedure; never convert or delete them manually.

During restore, keep writers stopped, verify migration checksums and function
ownership, restore encrypted vault history and audit events, then run dry-run
before resuming the schedule. The job uses the database clock captured once per
call. Time synchronization is therefore a release dependency: a clock that is
incorrectly ahead could violate the minimum retention window.

## 中文值班速查

- 默认命令是 `dry-run`，不会更新、删除或写审计。
- 真正清理必须同时传入 `--apply` 和固定确认串。
- 已完成命令至少保留 24 小时；`pending` 命令只告警，绝不静默删除。
- 到期的 `pending` 配对先转成 `expired`；终态配对至少保留 30 天。
- 三类变更各自每批最多 5,000 条，使用 `SKIP LOCKED`，可安全并行。
- 每个实际执行批次和审计记录同事务提交；任一失败则整批回滚。
- 快照、密钥环、清单、提交链和设备历史不属于本清理任务。
