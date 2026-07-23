# Trusted edge gateway

`@umn-gopher-assistant/edge-gateway` is the only supported public HTTP entry point for the
production Web/BFF tier. It is deliberately small: Node.js 24 built-in HTTP/TLS primitives,
streaming proxying, a bounded parser, and one narrowly scoped trust assertion for
`POST /api/ai/query`.

The gateway does **not** trust `Forwarded`, `X-Forwarded-*`, `X-Real-IP`, CDN client-IP
headers, or PROXY protocol. It always removes those headers. It also removes every
`X-Gopher-Ingress-AI-*` and `X-Gopher-Internal-AI-*` request/response header before adding
its own three ingress assertion headers. Client identity is taken only from the accepted
socket's `remoteAddress`.

## Trust boundary

```text
Internet
   |
   | TLS, source IP preserved end-to-end
   v
edge-gateway (public)
   |
   | private network only; no original IP forwarded
   v
Next.js Web/BFF (ClusterIP/private service)
   |
   | separately signed BFF-to-Core proof
   v
Core API
```

The Web service must have no public load balancer, NodePort, host port, or second Ingress.
Network policy must allow Web ingress only from the edge gateway workload and platform
health probes. The BFF independently fails closed in production when the trusted assertion
is absent or invalid, so a network-policy mistake does not silently weaken the quota.

Use direct TLS at this process, or a true source-preserving L4 TLS passthrough in front of
it. A conventional L7 load balancer that terminates TLS and opens a new TCP connection is
not compatible: the gateway will correctly identify the load balancer's network, not the
browser's. Forwarded headers and PROXY protocol are intentionally unsupported. Validate
source-IP preservation in the target environment before enabling public traffic.

## Privacy and assertion contract

For the AI endpoint only, the gateway:

1. Parses the actual peer as IPv4 or IPv6. IPv4-mapped IPv6 is normalized to IPv4.
2. Reduces it to an IPv4 `/24` or IPv6 `/64`.
3. HMACs the prefix, address family, and UTC date with
   `EDGE_GATEWAY_NETWORK_HMAC_KEY`. The resulting 32-byte identifier is stable only for the
   same network/day/key. Neither the address nor prefix is logged or forwarded.
4. Signs a 30-second assertion using the independent shared
   `GOPHER_AI_INGRESS_ASSERTION_HMAC_KEY`.

The Web BFF verifies this exact v1 canonical payload:

```text
umn-gopher-assistant:ai-ingress-network:v1
POST
/api/ai/query
<43-character-network-id>
<10-digit-expiry>
```

The headers are:

- `X-Gopher-Ingress-AI-Network: v1.<network-id>`
- `X-Gopher-Ingress-AI-Proof-Expires: <epoch-seconds>`
- `X-Gopher-Ingress-AI-Proof: v1.<hmac-sha256>`

NAT users intentionally share a network quota. Clearing a browser cookie cannot change this
network identifier. A separate global Core quota remains the final abuse ceiling.

## Production configuration

All production startup requirements are fail-closed.

| Variable                               | Production requirement                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `NODE_ENV`                             | `production`                                                                    |
| `EDGE_GATEWAY_WEB_ORIGIN`              | Absolute credential-free internal `http(s)` origin, with no path/query/fragment |
| `EDGE_GATEWAY_PUBLIC_ORIGIN`           | Absolute public `https` origin; its Host is enforced and injected upstream      |
| `EDGE_GATEWAY_NETWORK_HMAC_KEY`        | Canonical unpadded base64url encoding of 32–64 random bytes                     |
| `GOPHER_AI_INGRESS_ASSERTION_HMAC_KEY` | Different canonical 32–64 byte key; identical to the Web BFF value              |
| `EDGE_GATEWAY_TLS_MODE`                | `direct`                                                                        |
| `EDGE_GATEWAY_TLS_CERT_FILE`           | Absolute path to a read-only PEM certificate/chain                              |
| `EDGE_GATEWAY_TLS_KEY_FILE`            | Absolute path to its read-only PEM private key                                  |

Generate each HMAC key independently:

```bash
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url') + '\n')"
```

Never copy the network key into the assertion, cookie, BFF-to-Core, cursor, or service-auth
key. Production rejects the checked-in development values and rejects equal edge keys.
Rotate the network key independently; doing so invalidates the current day's network
pseudonyms. Rotate the shared assertion key as a coordinated edge/Web rollout because both
sides currently accept one active key.

Optional bounded settings:

| Variable                                      |                 Default | Range/meaning                     |
| --------------------------------------------- | ----------------------: | --------------------------------- |
| `EDGE_GATEWAY_LISTEN_HOST`                    | `0.0.0.0` in production | Canonical IP or DNS hostname      |
| `EDGE_GATEWAY_PORT`                           |                  `8080` | `1..65535`                        |
| `EDGE_GATEWAY_MAX_HEADER_BYTES`               |                 `16384` | `8192..65536`                     |
| `EDGE_GATEWAY_MAX_HEADERS_COUNT`              |                   `100` | `20..200`                         |
| `EDGE_GATEWAY_HEADERS_TIMEOUT_MS`             |                 `10000` | Header receive deadline           |
| `EDGE_GATEWAY_REQUEST_TIMEOUT_MS`             |                 `60000` | Complete request receive deadline |
| `EDGE_GATEWAY_UPSTREAM_INACTIVITY_TIMEOUT_MS` |                 `30000` | Bidirectional inactivity timeout  |
| `EDGE_GATEWAY_KEEP_ALIVE_TIMEOUT_MS`          |                  `5000` | Public keep-alive idle timeout    |
| `EDGE_GATEWAY_SHUTDOWN_GRACE_MS`              |                 `10000` | Drain window before forced close  |
| `EDGE_GATEWAY_WEB_READINESS_PATH`             |                     `/` | Internal path probed with `HEAD`  |
| `EDGE_GATEWAY_READINESS_TIMEOUT_MS`           |                  `2000` | `250..10000`                      |

`GET /healthz` is a process liveness probe and never calls Web. `GET /readyz` performs a
bounded `HEAD` against the configured internal Web readiness path; a connection error,
timeout, or 5xx returns 503. Neither probe emits or trusts client-address headers.

The proxy streams request and response bodies, rejects absolute-form targets and WebSocket
upgrades, bounds request and upstream response headers, strips hop-by-hop headers, aborts
upstream work when the client disconnects, and drains active connections on SIGTERM.
Request headers are forwarded as parser-validated raw pairs after trust-boundary stripping;
the edge-supplied request ID, forwarding metadata, and AI assertion can therefore never be
shadowed by duplicate client values. Response metadata is a fixed browser/application
allowlist (including cookies, redirects, validators, CSP, Next.js action metadata, and quota
headers), so an upstream response cannot invent arbitrary security-sensitive header names.
Structured access events include a random request ID, route class, method, status, and
duration only—never address, URL query, headers, or body.

## Container deployment

Build from the repository root so the locked workspace graph is available:

```bash
docker build -f apps/edge-gateway/Dockerfile -t gopher-assistant/edge-gateway:dev .
```

The image uses a digest-pinned Node.js base and UID/GID `10001`, has no runtime package
dependencies, and writes only to stdout/stderr. Run it with a read-only root filesystem,
all Linux capabilities dropped, `no-new-privileges`, and certificate/key secrets mounted
read-only. No writable volume is required.

Do not add a Compose edge service until a real Web container exists: pointing it at a host
development server would misrepresent the production network boundary.

## Verification

```bash
pnpm --filter @umn-gopher-assistant/edge-gateway lint
pnpm --filter @umn-gopher-assistant/edge-gateway typecheck
pnpm --filter @umn-gopher-assistant/edge-gateway test
pnpm --filter @umn-gopher-assistant/edge-gateway build
```

The tests use real local reverse proxies to exercise forged-header replacement, IPv4 and
IPv6 peers, UTC-day rotation, request/response streaming, header overflow, readiness,
upstream failure, and signer failure before Web is contacted.
