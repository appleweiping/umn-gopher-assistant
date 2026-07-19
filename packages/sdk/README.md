# `@umn-gopher-assistant/sdk`

This package is the lightweight TypeScript client for the shared OpenAPI 3.1
contract. Both the public types and runtime operation map are generated from
`openapi/openapi.yaml`; response and request types are not duplicated by hand.

```ts
import { GopherClient } from "@umn-gopher-assistant/sdk";

const client = new GopherClient({
  baseUrl: "https://assistant.example.edu/",
  accessToken: async () => tokenStore.current(),
});

const result = await client.request("listSources", {
  query: { campusId: "tc", limit: 25 },
  etag: previousEtag,
  signal: abortController.signal,
});

if (!result.notModified) console.log(result.data);
```

State-changing operations require an idempotency key in their TypeScript
options. Non-success responses become `GopherApiError` with validated RFC 9457
details. Unexpected 2xx/304 statuses, content types, malformed success JSON, or
success bodies that fail an implemented operation's strict runtime schema
become `GopherProtocolError` instead of being cast to the advertised result.
The runtime validators are generated directly from each implemented OpenAPI
success schema; unsupported schema keywords fail generation instead of being
silently ignored. Objects reject undeclared fields, while declared values are
validated without trimming, coercion, defaults, or extra domain rules.
Neither error retains request headers or an access token. Redirects are
disabled and operation URLs are constrained to the configured origin so
credentials and request bodies cannot silently cross origins. Tokens are not
attached to operations whose OpenAPI security is explicitly public. The only
accepted additional request header is `Accept-Language`; protocol and routing
headers use dedicated SDK behavior or remain reserved. Remote API base URLs
must use HTTPS; plaintext HTTP is accepted only for explicit loopback
development hosts. Problem details are trusted only when their media type and
status match the actual HTTP response.

Successful JSON responses are limited to 2 MiB and RFC 9457 error responses
to 64 KiB by default. For unencoded or explicitly `identity` responses, the
SDK rejects an oversized declared `Content-Length` before consumption. It does
not compare encoded lengths from gzip, Brotli, deflate, or other content
codings with a decoded-body limit. Every response is independently counted as
decoded stream bytes, so a missing, invalid, compressed, or understated length
cannot bypass the limit. Bytes are copied immediately into one bounded,
geometrically grown buffer rather than retaining attacker-controlled chunk
objects. The SDK cancels an oversized stream and raises a content-free
`GopherProtocolError` with code `response-body-too-large`. Callers can set
`maxSuccessResponseBodyBytes` and `maxErrorResponseBodyBytes` on
`GopherClient`; both must be positive integers and cannot exceed the absolute
8 MiB safety cap.

From the repository root:

```text
pnpm generate
pnpm check:generated
pnpm --filter @umn-gopher-assistant/sdk test
```

Generated files are committed so downstream builds do not need a generator.
CI must run `check:generated` to reject contract drift.

CLI and other trusted protocol clients can reuse the same public boundary:

```ts
import { validateImplementedSuccessBody } from "@umn-gopher-assistant/sdk";

const validation = validateImplementedSuccessBody(operationId, response.status, body);
if (!validation.success) throw new Error(validation.reason);
```
