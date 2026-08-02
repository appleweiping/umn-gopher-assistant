import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface RealmClient {
  attributes?: Record<string, string>;
  bearerOnly?: boolean;
  clientId: string;
  defaultClientScopes?: string[];
  directAccessGrantsEnabled?: boolean;
  enabled?: boolean;
  fullScopeAllowed?: boolean;
  optionalClientScopes?: string[];
  protocol?: string;
  publicClient?: boolean;
  redirectUris?: string[];
  serviceAccountsEnabled?: boolean;
  standardFlowEnabled?: boolean;
  webOrigins?: string[];
}

interface ClientScope {
  attributes?: Record<string, string>;
  name: string;
  protocol: string;
  protocolMappers?: {
    config?: Record<string, string>;
    protocolMapper?: string;
  }[];
}

interface RealmExport {
  attributes?: Record<string, string>;
  clientPolicies?: {
    policies?: {
      conditions?: { condition?: string; configuration?: Record<string, unknown> }[];
      enabled?: boolean;
      name?: string;
      profiles?: string[];
    }[];
  };
  clientProfiles?: {
    profiles?: {
      executors?: { configuration?: Record<string, string>; executor?: string }[];
      name?: string;
    }[];
  };
  clientScopes?: ClientScope[];
  clients: RealmClient[];
  identityProviders: unknown[];
  refreshTokenMaxReuse?: number;
  revokeRefreshToken?: boolean;
  roles: { realm: { name: string }[] };
  users: unknown[];
}

const realmPath = resolve(import.meta.dirname, "../../../infra/compose/keycloak/realm-export.json");
const composePath = resolve(import.meta.dirname, "../../../infra/compose/docker-compose.yml");
const reconcilerPath = resolve(import.meta.dirname, "../../../infra/compose/keycloak/reconcile-realm.mjs");
const realmSource = readFileSync(realmPath, "utf8");
const composeSource = readFileSync(composePath, "utf8");
const reconcilerSource = readFileSync(reconcilerPath, "utf8");
const rootPackage = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../package.json"), "utf8"),
) as {
  scripts?: Record<string, string>;
};
const realm = JSON.parse(realmSource) as RealmExport;

const requiredScopes = [
  "campus:read",
  "campus:write",
  "personal:read",
  "personal:write",
  "community:read",
  "community:write",
  "messages:read",
  "messages:write",
  "world:read",
  "world:write",
  "admin:read",
  "admin:write",
] as const;

function client(clientId: string): RealmClient {
  const value = realm.clients.find((candidate) => candidate.clientId === clientId);
  expect(value, `missing Keycloak client ${clientId}`).toBeDefined();
  return value as RealmClient;
}

describe("local Keycloak realm", () => {
  it("pins the reviewed Keycloak 26.7.0 multi-architecture image", () => {
    expect(composeSource).toContain(
      "quay.io/keycloak/keycloak:26.7.0@sha256:0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13",
    );
    expect(composeSource).not.toMatch(/quay\.io\/keycloak\/keycloak:26\.5\.5/u);
  });

  it("gates retained realms on a versioned, idempotent one-shot reconciliation", () => {
    expect(realm.attributes?.["gopher.assistant.realm-revision"]).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/u);
    expect(composeSource).toContain("keycloak-reconcile:");
    expect(composeSource).toContain(
      "node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57",
    );
    expect(composeSource).toContain("./keycloak/reconcile-realm.mjs:/reconciler/reconcile-realm.mjs:ro");
    expect(composeSource).toMatch(/keycloak-reconcile:[\s\S]*?keycloak:\n\s+condition: service_healthy/u);
    expect(rootPackage.scripts?.["smoke:identity:reconcile-offline"]).toBe(
      "node infra/compose/keycloak/reconcile-realm.mjs --offline-retained-realm-smoke",
    );
    expect(reconcilerSource).toContain("client-policies/profiles");
    expect(reconcilerSource).toContain("client-policies/policies");
    expect(reconcilerSource).toContain("dpop.bound.access.tokens");
    expect(reconcilerSource).toContain("personal:read");
    expect(reconcilerSource).toContain("personal:write");

    const secretMarker = "must-not-appear-in-reconciler-output";
    const smoke = spawnSync(process.execPath, [reconcilerPath, "--offline-retained-realm-smoke"], {
      encoding: "utf8",
      env: {
        ...process.env,
        KEYCLOAK_ADMIN_PASSWORD: secretMarker,
        KEYCLOAK_REALM_EXPORT_PATH: realmPath,
      },
      timeout: 20_000,
    });
    expect(smoke.status, smoke.stderr).toBe(0);
    const output = `${smoke.stdout}${smoke.stderr}`;
    expect(output).not.toContain(secretMarker);
    expect(smoke.stderr).toBe("");
    expect(JSON.parse(smoke.stdout)).toMatchObject({
      realm: "gopher-assistant-dev",
      revision: realm.attributes?.["gopher.assistant.realm-revision"],
      secondRunChanges: 0,
      status: "passed",
    });
    expect(JSON.parse(smoke.stdout).firstRunChanges).toBeGreaterThan(0);
  });

  it("contains only synthetic configuration and no credential material", () => {
    expect(realm.users).toEqual([]);
    expect(realm.identityProviders).toEqual([]);
    expect(realmSource).not.toMatch(/"secret"\s*:/u);
    expect(realmSource).not.toMatch(/umn.*saml|shibboleth/iu);
    expect(realm.clients.every((value) => value.directAccessGrantsEnabled === false)).toBe(true);
    expect(realm.clients.every((value) => value.serviceAccountsEnabled === false)).toBe(true);
    expect(realm.clients.every((value) => value.fullScopeAllowed === false)).toBe(true);
  });

  it("rotates refresh tokens with no reuse allowance", () => {
    expect(realm.revokeRefreshToken).toBe(true);
    expect(realm.refreshTokenMaxReuse).toBe(0);
  });

  it("requires authorization-code flows to be bound to dpop_jkt", () => {
    const profile = realm.clientProfiles?.profiles?.find(
      ({ name }) => name === "gopher-strict-dpop-code-binding",
    );
    const executor = profile?.executors?.find(
      ({ executor: executorName }) => executorName === "dpop-bind-enforcer",
    );
    expect(executor?.configuration).toEqual({
      "allow-only-refresh-token-binding": "false",
      "auto-configure": "false",
      "enforce-authorization-code-binding-to-dpop": "true",
    });

    const policy = realm.clientPolicies?.policies?.find(
      ({ name }) => name === "Gopher public OIDC DPoP binding",
    );
    expect(policy?.enabled).toBe(true);
    expect(policy?.profiles).toEqual(["gopher-strict-dpop-code-binding"]);
    expect(policy?.conditions).toEqual(
      expect.arrayContaining([
        {
          condition: "client-type",
          configuration: { protocol: "openid-connect" },
        },
        {
          condition: "client-access-type",
          configuration: { type: ["public"] },
        },
      ]),
    );
  });

  it("defines the least-privilege realm roles", () => {
    const roles = new Set(realm.roles.realm.map(({ name }) => name));

    for (const role of [
      "anonymous",
      "visitor",
      "campus-verified",
      "moderator",
      "admin",
      "security-reviewer",
    ]) {
      expect(roles.has(role), `missing realm role ${role}`).toBe(true);
    }
  });

  it("defines every API scope as a token scope", () => {
    const scopes = new Map(realm.clientScopes?.map((scope) => [scope.name, scope]));

    for (const scopeName of requiredScopes) {
      const scope = scopes.get(scopeName);
      expect(scope, `missing client scope ${scopeName}`).toBeDefined();
      expect(scope?.protocol).toBe("openid-connect");
      expect(scope?.attributes?.["include.in.token.scope"]).toBe("true");
    }
  });

  it("requires PKCE S256 for the browser client", () => {
    const web = client("gopher-web");

    expect(web.publicClient).toBe(true);
    expect(web.standardFlowEnabled).toBe(true);
    expect(web.attributes?.["pkce.code.challenge.method"]).toBe("S256");
    expect(web.attributes?.["dpop.bound.access.tokens"]).toBe("true");
    expect(web.attributes?.["access.token.header.type.rfc9068"]).toBe("true");
    expect(web.redirectUris).toEqual([
      "http://localhost:3000/auth/callback",
      "http://127.0.0.1:3000/auth/callback",
    ]);
    expect(web.attributes?.["post.logout.redirect.uris"]).toBe(
      "http://localhost:3000/##http://127.0.0.1:3000/",
    );
    expect(web.defaultClientScopes).toEqual(["gopher-platform-roles", "gopher-api-audience", "campus:read"]);
    expect(web.optionalClientScopes).toEqual(["personal:read", "personal:write"]);
    expect(web.defaultClientScopes).not.toEqual(expect.arrayContaining(["personal:read", "personal:write"]));
  });

  it("enables RFC 8628 only on the public CLI client", () => {
    const cli = client("gopher-cli");

    expect(cli.publicClient).toBe(true);
    expect(cli.standardFlowEnabled).toBe(false);
    expect(cli.attributes?.["oauth2.device.authorization.grant.enabled"]).toBe("true");
    expect(cli.attributes?.["dpop.bound.access.tokens"]).toBe("true");
    expect(cli.attributes?.["access.token.header.type.rfc9068"]).toBe("true");
    expect(cli.defaultClientScopes).toEqual(["gopher-platform-roles", "gopher-api-audience", "campus:read"]);
    expect(cli.defaultClientScopes?.filter((scope) => cli.optionalClientScopes?.includes(scope))).toEqual([]);
    expect(cli.optionalClientScopes).toEqual(["offline_access"]);
    expect([...(cli.defaultClientScopes ?? []), ...(cli.optionalClientScopes ?? [])]).not.toEqual(
      expect.arrayContaining(["campus:write", "personal:read", "community:write", "admin:write"]),
    );
  });

  it("keeps MCP public/PKCE and the API bearer-only", () => {
    const mcp = client("gopher-mcp");
    const api = client("gopher-api");

    expect(mcp.publicClient).toBe(true);
    expect(mcp.standardFlowEnabled).toBe(true);
    expect(mcp.attributes?.["pkce.code.challenge.method"]).toBe("S256");
    expect(mcp.attributes?.["dpop.bound.access.tokens"]).toBe("true");
    expect(mcp.attributes?.["access.token.header.type.rfc9068"]).toBe("true");
    expect(mcp.redirectUris).toEqual(["http://127.0.0.1:4100/oauth/callback"]);
    expect(mcp.webOrigins).toEqual(["http://127.0.0.1:4100"]);
    expect(mcp.attributes?.["post.logout.redirect.uris"]).toBe("http://127.0.0.1:4100/");
    expect(mcp.defaultClientScopes).toEqual(["gopher-platform-roles", "gopher-mcp-audience", "campus:read"]);
    expect(mcp.optionalClientScopes).toEqual([]);
    expect(api.bearerOnly).toBe(true);
    expect(api.publicClient).toBe(false);
    expect(api.standardFlowEnabled).toBe(false);
    expect(api.defaultClientScopes).toEqual([]);
    expect(api.optionalClientScopes).toEqual([]);
    expect(api.attributes?.["dpop.bound.access.tokens"]).toBeUndefined();
    expect(api.attributes?.["access.token.header.type.rfc9068"]).toBeUndefined();
  });

  it("uses a local canonical MCP audience without Core API token pass-through", () => {
    const scope = realm.clientScopes?.find(({ name }) => name === "gopher-mcp-audience");
    const audience = scope?.protocolMappers?.find(
      ({ protocolMapper }) => protocolMapper === "oidc-audience-mapper",
    )?.config?.["included.custom.audience"];

    expect(audience).toBe("http://127.0.0.1:4100/mcp");
    expect(client("gopher-web").defaultClientScopes).toContain("gopher-api-audience");
    expect(client("gopher-cli").defaultClientScopes).toContain("gopher-api-audience");
  });

  it("does not use wildcard redirect or logout boundaries", () => {
    for (const value of realm.clients) {
      expect(value.redirectUris ?? []).not.toEqual(expect.arrayContaining([expect.stringContaining("*")]));
      expect(value.attributes?.["post.logout.redirect.uris"] ?? "").not.toContain("*");
    }
  });
});
