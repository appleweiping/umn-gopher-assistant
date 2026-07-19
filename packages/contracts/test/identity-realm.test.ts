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
  clientScopes?: ClientScope[];
  clients: RealmClient[];
  identityProviders: unknown[];
  roles: { realm: { name: string }[] };
  users: unknown[];
}

const realmPath = resolve(import.meta.dirname, "../../../infra/compose/keycloak/realm-export.json");
const realmSource = readFileSync(realmPath, "utf8");
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
  it("contains only synthetic configuration and no credential material", () => {
    expect(realm.users).toEqual([]);
    expect(realm.identityProviders).toEqual([]);
    expect(realmSource).not.toMatch(/"secret"\s*:/u);
    expect(realmSource).not.toMatch(/umn.*saml|shibboleth/iu);
    expect(realm.clients.every((value) => value.directAccessGrantsEnabled === false)).toBe(true);
    expect(realm.clients.every((value) => value.serviceAccountsEnabled === false)).toBe(true);
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
    expect(web.redirectUris).toEqual([
      "http://localhost:3000/auth/callback",
      "http://127.0.0.1:3000/auth/callback",
    ]);
    expect(web.attributes?.["post.logout.redirect.uris"]).toBe(
      "http://localhost:3000/##http://127.0.0.1:3000/",
    );
    expect(web.optionalClientScopes).not.toContain("offline_access");
  });

  it("enables RFC 8628 only on the public CLI client", () => {
    const cli = client("gopher-cli");

    expect(cli.publicClient).toBe(true);
    expect(cli.standardFlowEnabled).toBe(false);
    expect(cli.attributes?.["oauth2.device.authorization.grant.enabled"]).toBe("true");
    expect(cli.defaultClientScopes).toContain("campus:read");
    expect([...(cli.defaultClientScopes ?? []), ...(cli.optionalClientScopes ?? [])]).toEqual(
      expect.arrayContaining([...requiredScopes]),
    );
    expect(cli.defaultClientScopes?.filter((scope) => cli.optionalClientScopes?.includes(scope))).toEqual([]);
    expect(cli.optionalClientScopes).toContain("offline_access");
  });

  it("keeps MCP public/PKCE and the API bearer-only", () => {
    const mcp = client("gopher-mcp");
    const api = client("gopher-api");

    expect(mcp.publicClient).toBe(true);
    expect(mcp.standardFlowEnabled).toBe(true);
    expect(mcp.attributes?.["pkce.code.challenge.method"]).toBe("S256");
    expect(mcp.redirectUris).toEqual(["http://127.0.0.1:4100/oauth/callback"]);
    expect(mcp.webOrigins).toEqual(["http://127.0.0.1:4100"]);
    expect(mcp.attributes?.["post.logout.redirect.uris"]).toBe("http://127.0.0.1:4100/");
    expect(mcp.defaultClientScopes).toContain("campus:read");
    expect(mcp.defaultClientScopes).toContain("gopher-mcp-audience");
    expect(mcp.defaultClientScopes).not.toContain("gopher-api-audience");
    expect(api.bearerOnly).toBe(true);
    expect(api.publicClient).toBe(false);
    expect(api.standardFlowEnabled).toBe(false);
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
