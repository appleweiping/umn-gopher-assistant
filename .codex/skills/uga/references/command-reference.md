# `uga` command reference

## Commands

| Command                 | Purpose                                                  | Network effect            |
| ----------------------- | -------------------------------------------------------- | ------------------------- |
| `uga init`              | Write non-secret endpoint/profile configuration          | None                      |
| `uga doctor`            | Validate profile, runtime, and deployment reachability   | Read-only                 |
| `uga auth login`        | Start RFC 8628 device authorization                      | Identity only             |
| `uga auth status`       | Report non-secret environment/keychain state             | Local read only           |
| `uga auth logout`       | Delete the profile keychain entry containing both tokens | Local credential deletion |
| `uga campuses list`     | List the five supported campuses                         | Public read               |
| `uga sources list`      | List provenance and connector-policy descriptors         | Public read               |
| `uga world manifest`    | Read a versioned schematic/verified world manifest       | Public read               |
| `uga request get\|head` | Guarded relative `/v1` read escape hatch                 | Public/protected read     |

No live write commands exist in the initial CLI.

## Exit codes

| Code | Meaning                                                                                                     |
| ---: | ----------------------------------------------------------------------------------------------------------- |
|    0 | Success                                                                                                     |
|    2 | Usage or validation error                                                                                   |
|    3 | Missing or invalid profile/configuration                                                                    |
|    4 | Authentication required, denied, expired, cancelled, or keychain unavailable (`secure-storage-unavailable`) |
|    5 | Authenticated but not permitted                                                                             |
|    6 | Dependency or deployment unavailable                                                                        |
|    7 | HTTP/API/protocol contract violation                                                                        |
|    8 | Conflict or stale precondition                                                                              |
|    9 | Unexpected internal failure                                                                                 |

## Automation rules

1. Put `--json` before or after the command only where `uga --help` documents it.
2. Parse a single JSON document from stdout.
3. Check the process exit code before using `data`.
4. Treat error codes and messages as diagnostics, not stable secrets or stack
   traces.
5. Bound retries. Only retry an idempotent read after exit code `6`, with capped
   backoff; the JSON envelope has no `retryable` field. Never retry authentication
   denial, permission denial, usage errors, or writes.
6. Do not persist the full output of authentication commands.

## Campus identifiers

Use only `tc`, `duluth`, `crookston`, `morris`, or `rochester`. Rochester uses
the Twin Cities academic institution mapping until an approved source says
otherwise.
