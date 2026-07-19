# `uga` CLI

`uga` is the secure, scriptable command-line client for UMN Gopher Assistant. It is generated around the same OpenAPI operation catalog as `@umn-gopher-assistant/sdk`; it deliberately exposes only API operations whose contract is marked `x-runtime-status: implemented`.

The current release is read-only. It does **not** claim that contract-only academics, events, community, messaging, AI, moderation, routing, or live-event APIs work.

## Install and verify

Node.js `>=24 <25` and pnpm 10 are required. The repository enforces the range
at installation with `engine-strict=true`; the installed binary also checks it
at process startup and exits with code 3 before loading configuration or
credentials when another Node major is used. CI and local release evidence use
Node.js 24.11.1.

```console
pnpm --filter @umn-gopher-assistant/cli build
pnpm --filter @umn-gopher-assistant/cli link --global
uga --help
uga --json doctor
```

Use `pnpm link --global` only from a trusted checkout. The installed binary is `uga`.

## Configuration

Create a named profile with non-secret endpoints:

```console
uga init --profile local \
  --api-base-url http://127.0.0.1:4000 \
  --issuer http://127.0.0.1:8080/realms/gopher-assistant-dev
```

HTTPS is mandatory except for the explicit loopback hosts `localhost`, `127.0.0.0/8`, and `[::1]`. URLs containing credentials, fragments, or query strings are rejected. Precedence is command-line override, environment, then saved profile:

- `--profile` / `UGA_PROFILE`
- `--api-base-url` / `UGA_API_BASE_URL`
- `--issuer` / `UGA_ISSUER`
- `UGA_ACCESS_TOKEN` for an explicit process-scoped access token

Configuration contains only `apiBaseUrl` and `issuer`. Any token-, password-, secret-, authorization-, cookie-, or API-key-shaped field makes the entire file invalid. Profile files are stored at:

- Windows: `%APPDATA%\umn-gopher-assistant\uga\config.json`
- macOS: `~/Library/Application Support/umn-gopher-assistant/uga/config.json`
- Linux/Unix: `$XDG_CONFIG_HOME/umn-gopher-assistant/uga/config.json`, or `~/.config/...`

## Authentication

```console
uga --profile local auth login
uga --json --profile local auth status
uga --profile local auth logout
```

Login uses RFC 8628 device authorization discovered from the configured OIDC issuer. There is no password grant and the CLI never asks for a UMN password. Scopes are fixed to `openid offline_access campus:read`; the CLI does not accept arbitrary scope escalation.

Each authenticated profile stores its access and refresh token together in one OS-keychain entry through optional `@napi-rs/keyring` 1.3.0. If its native backend is absent or refuses a write, login fails closed with exit code 4 and error code `secure-storage-unavailable`: no authenticated success is emitted, no process-local authentication fallback is retained, and nothing is written in plaintext. Install or repair the platform credential-store backend and retry. `UGA_ACCESS_TOKEN` is read directly from the environment and is never copied into config or keychain. PAT support is planned and reported as such; it is not simulated.

`auth logout` deletes the profile's entire keychain entry, including both tokens. The keychain result distinguishes `deleted`, `absent`, and `backend-error`. Only the first two are successful outcomes; a native exception, unavailable module, or unconfirmed deletion fails closed with exit code 4 and `secure-storage-unavailable`, because credentials may still remain. There is no separate CLI session to remove; an explicitly supplied `UGA_ACCESS_TOKEN` remains in the caller's environment and is reported separately.

Device polling handles `authorization_pending`, RFC 8628 `slow_down`, denial, expiry, Ctrl-C cancellation, refresh rotation, timeouts, and malformed identity-provider responses. Redirects are never followed.

## Commands

```console
uga --json --profile local campuses list
uga --json --profile local sources list --campus tc --limit 20
uga --json --profile local sources list --cursor 'opaque-server-cursor'
uga --json --profile local world manifest --campus duluth
```

The raw repair hatch remains read-only:

```console
uga --json --profile local request get '/v1/sources?campusId=tc&limit=10'
uga --json --profile local request head '/v1/worlds/tc/manifest'
```

Raw requests accept only GET or HEAD, a normalized relative `/v1/...` path, and a path matched to an **implemented GET operation** in the generated SDK catalog. Absolute URLs, user information, fragments, dot segments (including encoded variants), encoded separators, credential-like query parameters, redirects, and contract-only paths are rejected. Quote query strings in shells where `&` has special meaning.

Raw success is still contract-checked: GET and HEAD require a status declared by the matched operation, GET JSON is validated with the SDK's generated response schema, and HEAD must contain no response body. A mismatch is a protocol failure with exit code 7, never a false success.

## Output contract

Human-readable output is the default. With `--json`, stdout contains exactly one compact JSON object and no ANSI, prompt, progress, or credential text. Device instructions and diagnostics go to stderr.

Success:

```json
{ "command": "campuses.list", "data": [], "meta": { "profile": "local" }, "ok": true }
```

Failure:

```json
{
  "command": "usage",
  "error": { "code": "invalid-usage", "exitCode": 2, "message": "..." },
  "meta": { "profile": "local" },
  "ok": false
}
```

Response bodies are bounded to 1 MiB. Machine output may include safe status, ETag, request ID, cursor, scope, and expiration metadata; it never includes bearer, refresh, device, or keychain values.

## Exit codes

| Code | Meaning                                                                                                          |
| ---: | ---------------------------------------------------------------------------------------------------------------- |
|    0 | success, including an empty list or an unhealthy `doctor` report                                                 |
|    2 | invalid command, option, argument, or unsafe raw path                                                            |
|    3 | missing or invalid configuration                                                                                 |
|    4 | authentication missing, expired, denied, cancelled, or secure storage unavailable (`secure-storage-unavailable`) |
|    5 | permission denied                                                                                                |
|    6 | API, identity provider, timeout, rate limit, or network unavailable                                              |
|    7 | malformed or contract-violating protocol response                                                                |
|    8 | state conflict                                                                                                   |
|    9 | unexpected internal failure                                                                                      |

`doctor` is diagnostic: missing auth or an unreachable endpoint is returned as structured check data with exit 0, so automation can inspect every check in one pass.

## Security boundaries

- Native fetch uses `redirect: "error"`, bounded responses, explicit JSON media types, request timeouts, and caller cancellation.
- The SDK controls typed request methods, paths, query fields, protocol headers, RFC 9457 errors, and bearer attachment.
- Public operations do not receive a bearer token. The raw client consults the generated operation's `public` flag before resolving auth.
- Identity discovery must return the exact configured issuer. Device, token, verification, API, and issuer URLs require HTTPS except loopback.
- Errors are normalized and credential patterns are redacted. Unknown exceptions never expose their original message.
- Config files reject symlinks and oversized content, and are atomically replaced with user-only modes where the platform supports them.
