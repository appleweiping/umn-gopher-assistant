#!/usr/bin/env node

const identityBaseUrl = new URL(process.env.IDENTITY_BASE_URL ?? "http://127.0.0.1:8080/");
const realm = process.env.IDENTITY_REALM ?? "gopher-assistant-dev";
const issuer = new URL(`realms/${encodeURIComponent(realm)}`, identityBaseUrl).toString().replace(/\/$/u, "");
const requestTimeoutMilliseconds = 10_000;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(requestTimeoutMilliseconds),
  });
  return response;
}

async function readJson(response, label) {
  invariant(response.ok, `${label} returned HTTP ${String(response.status)}`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  invariant(contentType === "application/json", `${label} did not return application/json`);
  return response.json();
}

function requiredString(record, key, label) {
  const value = record?.[key];
  invariant(typeof value === "string" && value.length > 0, `${label} is missing ${key}`);
  return value;
}

async function verifyDiscoveryAndDeviceFlow() {
  const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
  const discovery = await readJson(await request(discoveryUrl), "OIDC discovery");

  invariant(discovery.issuer === issuer, "OIDC discovery issuer is not exact");
  invariant(
    Array.isArray(discovery.code_challenge_methods_supported) &&
      discovery.code_challenge_methods_supported.includes("S256"),
    "OIDC discovery does not advertise PKCE S256",
  );

  const deviceEndpoint = requiredString(discovery, "device_authorization_endpoint", "OIDC discovery");
  const tokenEndpoint = requiredString(discovery, "token_endpoint", "OIDC discovery");
  invariant(deviceEndpoint.startsWith(`${issuer}/`), "Device endpoint escaped the configured issuer");
  invariant(tokenEndpoint.startsWith(`${issuer}/`), "Token endpoint escaped the configured issuer");

  const deviceResponse = await readJson(
    await request(deviceEndpoint, {
      body: new URLSearchParams({
        client_id: "gopher-cli",
        scope: "openid campus:read offline_access",
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    }),
    "RFC 8628 device authorization",
  );

  requiredString(deviceResponse, "device_code", "RFC 8628 device authorization");
  requiredString(deviceResponse, "user_code", "RFC 8628 device authorization");
  requiredString(deviceResponse, "verification_uri", "RFC 8628 device authorization");
  invariant(
    Number.isFinite(deviceResponse.expires_in) && deviceResponse.expires_in > 0,
    "RFC 8628 response has an invalid expiry",
  );

  return { deviceAuthorization: true, issuer, pkceS256: true };
}

async function adminGet(path, accessToken) {
  return readJson(
    await request(new URL(path, identityBaseUrl), {
      headers: { authorization: `Bearer ${accessToken}` },
    }),
    `Keycloak Admin API ${path}`,
  );
}

async function verifyAdminConfiguration() {
  const username = process.env.KEYCLOAK_ADMIN;
  const password = process.env.KEYCLOAK_ADMIN_PASSWORD;
  invariant(
    (username === undefined) === (password === undefined),
    "Set both KEYCLOAK_ADMIN and KEYCLOAK_ADMIN_PASSWORD, or neither",
  );
  if (username === undefined || password === undefined) return { performed: false };

  const tokenResponse = await readJson(
    await request(new URL("realms/master/protocol/openid-connect/token", identityBaseUrl), {
      body: new URLSearchParams({
        client_id: "admin-cli",
        grant_type: "password",
        password,
        username,
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    }),
    "local Keycloak admin authentication",
  );
  const accessToken = requiredString(tokenResponse, "access_token", "local Keycloak admin authentication");
  const encodedRealm = encodeURIComponent(realm);
  const clients = await adminGet(`admin/realms/${encodedRealm}/clients`, accessToken);
  invariant(Array.isArray(clients), "Keycloak clients response is not an array");

  const expectations = new Map([
    ["gopher-web", { audience: "gopher-api-audience", optionalScopes: [], publicClient: true }],
    [
      "gopher-cli",
      {
        audience: "gopher-api-audience",
        optionalScopes: ["offline_access"],
        publicClient: true,
      },
    ],
    ["gopher-mcp", { audience: "gopher-mcp-audience", optionalScopes: [], publicClient: true }],
    ["gopher-api", { audience: undefined, optionalScopes: [], publicClient: false }],
  ]);

  for (const [clientId, expectation] of expectations) {
    const client = clients.find((candidate) => candidate?.clientId === clientId);
    invariant(client !== undefined, `Keycloak is missing ${clientId}`);
    invariant(client.publicClient === expectation.publicClient, `${clientId} has the wrong client type`);
    invariant(client.directAccessGrantsEnabled === false, `${clientId} enables the password grant`);
    invariant(client.serviceAccountsEnabled === false, `${clientId} enables service accounts`);
    const defaultScopes = await adminGet(
      `admin/realms/${encodedRealm}/clients/${encodeURIComponent(client.id)}/default-client-scopes`,
      accessToken,
    );
    invariant(Array.isArray(defaultScopes), `${clientId} default scopes response is not an array`);
    const scopeNames = new Set(defaultScopes.map((scope) => scope.name));
    const optionalScopes = await adminGet(
      `admin/realms/${encodedRealm}/clients/${encodeURIComponent(client.id)}/optional-client-scopes`,
      accessToken,
    );
    invariant(Array.isArray(optionalScopes), `${clientId} optional scopes response is not an array`);
    invariant(
      JSON.stringify(optionalScopes.map((scope) => scope.name).sort()) ===
        JSON.stringify([...expectation.optionalScopes].sort()),
      `${clientId} has unexpected optional scopes`,
    );
    if (expectation.audience === undefined) {
      invariant(!scopeNames.has("gopher-api-audience"), `${clientId} unexpectedly receives API audience`);
      invariant(!scopeNames.has("gopher-mcp-audience"), `${clientId} unexpectedly receives MCP audience`);
    } else {
      invariant(scopeNames.has(expectation.audience), `${clientId} is missing its resource audience`);
      const otherAudience =
        expectation.audience === "gopher-api-audience" ? "gopher-mcp-audience" : "gopher-api-audience";
      invariant(!scopeNames.has(otherAudience), `${clientId} receives a confused resource audience`);
    }
  }

  const clientScopes = await adminGet(`admin/realms/${encodedRealm}/client-scopes`, accessToken);
  const mcpAudienceScope = clientScopes.find((scope) => scope?.name === "gopher-mcp-audience");
  invariant(mcpAudienceScope !== undefined, "Keycloak is missing the MCP audience scope");
  const mappers = await adminGet(
    `admin/realms/${encodedRealm}/client-scopes/${encodeURIComponent(mcpAudienceScope.id)}/protocol-mappers/models`,
    accessToken,
  );
  invariant(
    mappers.some(
      (mapper) =>
        mapper?.protocolMapper === "oidc-audience-mapper" &&
        mapper?.config?.["included.custom.audience"] === "http://127.0.0.1:4100/mcp",
    ),
    "MCP audience mapper is not bound to the exact local resource URL",
  );

  return {
    audienceSeparation: true,
    clients: expectations.size,
    performed: true,
    scopeEscalationPreventedByClientLinkage: true,
  };
}

const publicVerification = await verifyDiscoveryAndDeviceFlow();
const adminVerification = await verifyAdminConfiguration();
console.log(
  JSON.stringify(
    {
      adminVerification,
      publicVerification,
      status: "passed",
    },
    null,
    2,
  ),
);
