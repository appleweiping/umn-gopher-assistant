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
details. Unexpected 2xx/304 statuses, content types, or malformed success JSON
become `GopherProtocolError` instead of being cast to the advertised result.
Neither error retains request headers or an access token. Redirects are
disabled and operation URLs are constrained to the configured origin so
credentials and request bodies cannot silently cross origins. Tokens are not
attached to operations whose OpenAPI security is explicitly public. The only
accepted additional request header is `Accept-Language`; protocol and routing
headers use dedicated SDK behavior or remain reserved. Remote API base URLs
must use HTTPS; plaintext HTTP is accepted only for explicit loopback
development hosts. Problem details are trusted only when their media type and
status match the actual HTTP response.

From the repository root:

```text
pnpm generate
pnpm check:generated
pnpm --filter @umn-gopher-assistant/sdk test
```

Generated files are committed so downstream builds do not need a generator.
CI must run `check:generated` to reject contract drift.
