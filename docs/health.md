# API health and production readiness

`GET /v1/health` is an anonymous, cache-disabled **liveness** endpoint. A `200`
response means only that the Core API process and HTTP stack can answer a
request. It does not prove that authenticated or personal-data workflows are
available.

In particular, the current endpoint does not probe:

- the Redis service that atomically enforces DPoP nonce, replay, and rate
  state, or a separately configured personal read-proof replay Redis service;
- the personal-vault PostgreSQL runtime role, account resolver, RLS policies,
  or encrypted-vault tables;
- the OIDC issuer or its JWKS endpoint;
- optional catalog, search, notification, media, world, or AI dependencies.

The local smoke test deliberately uses this liveness endpoint so an anonymous
foundation build remains reproducible without production credentials.

## Production release gate

Do not configure a load balancer, Kubernetes readiness probe, deployment
promotion check, or service-level objective to treat `/v1/health` as
readiness. Before any production claim, provide a bounded composite readiness
probe (or equivalent external synthetic check) that fails closed when a
dependency required by an enabled route is unavailable.

At minimum, an API instance serving authenticated personal-vault routes must
verify, under short deadlines:

1. DPoP Redis connectivity plus the same atomic-script capability used by
   requests, without consuming a user's replay namespace, and personal
   read-proof replay Redis connectivity when it is a distinct service;
2. a read/write connection through the restricted personal API PostgreSQL role,
   including migration-version compatibility and a transaction-local RLS
   isolation probe;
3. availability of a currently valid OIDC verification-key set, with an
   explicitly documented cache and issuer-outage policy.

The readiness response must expose only dependency class, state, checked time,
and a stable non-secret reason code. It must never return connection strings,
credentials, account identifiers, Redis keys, SQL text, token material, or
exception messages. Apply an overall deadline, run independent probes in
parallel, return `503` on required-dependency failure, and keep liveness
independent so orchestration can distinguish restart-worthy process failure
from an upstream outage.

Until that probe and its failure-path tests exist, this repository supports
local/integration liveness only and is not production-ready.
