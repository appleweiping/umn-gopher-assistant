---
name: uga
description: Use the UMN Gopher Assistant `uga` CLI to configure a local profile, diagnose connectivity, authenticate with the RFC 8628 device flow, or read implemented campus, source, and schematic-world data. Use this skill when a user asks for command-line access, machine-readable campus data, CLI authentication help, or safe automation against a UMN Gopher Assistant deployment.
---

# UGA CLI

## Overview

Use `uga` as the evidence-preserving command-line client for UMN Gopher
Assistant. Prefer its generated, implemented commands and JSON mode over custom
HTTP calls.

## Safety boundary

- Treat the deployment as independent and unofficial unless the current
  deployment supplies reviewed institutional evidence.
- Never request, paste, or print a UMN password, Canvas token, cookie, bearer or
  refresh token, or private key. Never persist credentials outside the CLI-managed
  operating-system keychain.
- Authentication uses the browser/device verification flow. Access and refresh
  tokens may persist only together in the operating-system keychain; a missing
  keychain fails with `secure-storage-unavailable` and has no plaintext fallback.
- Do not describe contract-only OpenAPI operations as available. The initial CLI
  exposes only health/diagnostics, campuses, sources, and world manifests.
- Do not simulate registration, payment, student-record writeback, moderation,
  community posting, AI queries, or world publishing through raw requests.
- The CLI has no live write commands. If a user asks for one, report that the
  backing operation and preview/confirmation contract must be implemented and
  reviewed first.

## Workflow

1. Run `uga --json doctor` when deployment or profile state is unknown.
2. If configuration is missing, show the proposed `uga init` command before
   writing a profile. Profiles contain endpoints and preferences, never tokens.
3. Run `uga --json auth status` before a protected operation.
4. When login is required, run `uga auth login` and let the human complete the
   displayed verification URL and user code. Never complete the identity step
   on the user's behalf.
5. Use the narrow generated command that matches the request.
6. Use `--json` for automation, parse the envelope, and preserve the command's
   exit code. Do not scrape human-formatted text.
7. Report freshness, verification state, source/license status, and official
   deep links with the returned data.

## Implemented reads

```text
uga --json doctor
uga --json auth status
uga --json campuses list
uga --json sources list --campus tc --limit 25
uga --json world manifest --campus morris
```

The escape hatch accepts only safe relative `GET` or `HEAD` paths under `/v1`:

```text
uga --json request get /v1/health
```

Prefer the generated commands. Never pass an absolute URL, credentials,
fragments, dot segments, or credential-like query parameters to `uga request`.

## Authentication and profiles

Use a named profile when more than one deployment exists:

```text
uga init --profile local \
  --api-base-url http://127.0.0.1:4000 \
  --issuer http://127.0.0.1:8080/realms/gopher-assistant-dev
uga --profile local auth login
```

Remote API and issuer endpoints must use HTTPS. Plain HTTP is valid only for an
explicit loopback development host. `UGA_ACCESS_TOKEN` is an ephemeral
automation override and must come from a secret manager; never place it in a
profile, shell history, issue, log, or generated file.

## Machine-readable handling

- Success is exit code `0`. Preserve nonzero exit codes instead of converting a
  failed command into apparent success.
- Keep stdout reserved for the JSON envelope. Send explanations and diagnostics
  to stderr.
- Redact authorization headers, device codes, access/refresh tokens, cookies,
  and credential-like URL parameters before quoting output.
- See [command and exit-code reference](references/command-reference.md) before
  building automation or interpreting a failure.

## Raw-request decision

Use `uga request` only when all conditions are true:

1. no generated implemented command covers the read;
2. the method is `GET` or `HEAD`;
3. the path is relative, normalized, and under `/v1`;
4. the request needs no custom authorization or routing header; and
5. the path matches an implemented OpenAPI operation and uses only that
   operation's declared query parameters. Unknown and contract-only paths are
   rejected locally with exit code `2`; a remote `404` on an implemented path
   must still be reported honestly.

The CLI accepts raw success only when the status is declared by the matched
operation. It validates GET JSON against the generated response schema and
requires HEAD responses to have no body; violations return exit code `7`.

Otherwise stop and use the SDK/OpenAPI development workflow to add a reviewed
operation.
