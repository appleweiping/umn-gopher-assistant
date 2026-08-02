#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const revisionAttribute = "gopher.assistant.realm-revision";
const managedPersonalScopes = new Set(["personal:read", "personal:write"]);
const managedClientAttributeNames = ["access.token.header.type.rfc9068", "dpop.bound.access.tokens"];
const requestTimeoutMilliseconds = 10_000;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function encodePath(value) {
  return encodeURIComponent(value);
}

function isPlaintextDevelopmentHost(hostname) {
  if (hostname === "keycloak" || hostname === "localhost" || hostname === "::1") return true;
  const octets = hostname.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) >= 0 && Number(octet) <= 255)
  );
}

function matchesTemplate(actual, desired) {
  if (Array.isArray(desired)) {
    return (
      Array.isArray(actual) &&
      actual.length === desired.length &&
      desired.every((value, index) => matchesTemplate(actual[index], value))
    );
  }
  if (typeof desired === "object" && desired !== null) {
    return (
      typeof actual === "object" &&
      actual !== null &&
      Object.entries(desired).every(([key, value]) => matchesTemplate(actual[key], value))
    );
  }
  return Object.is(actual, desired);
}

function mergeNamedResource(resources, desired) {
  const next = resources.map((resource) =>
    resource?.name === desired.name ? { ...resource, ...desired } : resource,
  );
  if (!resources.some((resource) => resource?.name === desired.name)) next.push(desired);
  return next;
}

function requiredNamedResource(resources, name, label) {
  invariant(Array.isArray(resources), `${label} response was not an array`);
  const matches = resources.filter((resource) => resource?.name === name);
  invariant(matches.length === 1, `${label} must contain exactly one ${name}`);
  return matches[0];
}

function desiredResources(realm) {
  const revision = realm?.attributes?.[revisionAttribute];
  invariant(typeof realm?.realm === "string" && realm.realm.length > 0, "Realm export has no realm name");
  invariant(
    typeof revision === "string" && /^\d{4}-\d{2}-\d{2}\.\d+$/u.test(revision),
    "Realm export has no valid reconciliation revision",
  );

  const scopes = [...managedPersonalScopes].map((name) =>
    requiredNamedResource(realm.clientScopes, name, "Realm client scopes"),
  );
  const profile = requiredNamedResource(
    realm.clientProfiles?.profiles,
    "gopher-strict-dpop-code-binding",
    "Realm client profiles",
  );
  const policy = requiredNamedResource(
    realm.clientPolicies?.policies,
    "Gopher public OIDC DPoP binding",
    "Realm client policies",
  );
  const clients = realm.clients?.filter((client) => typeof client?.clientId === "string") ?? [];
  for (const clientId of ["gopher-web", "gopher-cli", "gopher-mcp", "gopher-api"]) {
    invariant(
      clients.filter((client) => client.clientId === clientId).length === 1,
      `Realm export must contain exactly one ${clientId} client`,
    );
  }
  invariant(
    clients
      .filter((client) => client.publicClient === true)
      .every((client) => client.attributes?.["dpop.bound.access.tokens"] === "true"),
    "Every exported public client must require DPoP-bound access tokens",
  );

  return { clients, policy, profile, realmName: realm.realm, revision, scopes };
}

async function reconcileRealm({ desiredRealm, request }) {
  const desired = desiredResources(desiredRealm);
  const encodedRealm = encodePath(desired.realmName);
  let changes = 0;
  const mutate = async (path, options) => {
    await request(path, options);
    changes += 1;
  };

  const realm = await request(`admin/realms/${encodedRealm}`);
  invariant(realm?.realm === desired.realmName, "Admin API returned a different realm");

  let clientScopes = await request(`admin/realms/${encodedRealm}/client-scopes`);
  invariant(Array.isArray(clientScopes), "Client scopes response was not an array");
  for (const desiredScope of desired.scopes) {
    const matches = clientScopes.filter((scope) => scope?.name === desiredScope.name);
    invariant(matches.length <= 1, `Realm has duplicate ${desiredScope.name} client scopes`);
    const existing = matches[0];
    if (existing === undefined) {
      await mutate(`admin/realms/${encodedRealm}/client-scopes`, {
        body: desiredScope,
        expectedStatuses: [201],
        method: "POST",
      });
    } else if (!matchesTemplate(existing, desiredScope)) {
      invariant(typeof existing.id === "string" && existing.id.length > 0, `${desiredScope.name} has no id`);
      await mutate(`admin/realms/${encodedRealm}/client-scopes/${encodePath(existing.id)}`, {
        body: { ...existing, ...desiredScope },
        expectedStatuses: [200, 204],
        method: "PUT",
      });
    }
  }

  clientScopes = await request(`admin/realms/${encodedRealm}/client-scopes`);
  const personalScopes = new Map(
    desired.scopes.map((scope) => {
      const current = requiredNamedResource(clientScopes, scope.name, "Updated client scopes");
      invariant(typeof current.id === "string" && current.id.length > 0, `${scope.name} has no id`);
      invariant(matchesTemplate(current, scope), `${scope.name} did not converge`);
      return [scope.name, current];
    }),
  );

  const clients = await request(`admin/realms/${encodedRealm}/clients?max=1000`);
  invariant(Array.isArray(clients), "Clients response was not an array");
  for (const desiredClient of desired.clients) {
    const matches = clients.filter((client) => client?.clientId === desiredClient.clientId);
    invariant(matches.length === 1, `Realm must contain exactly one ${desiredClient.clientId} client`);
    let client = matches[0];
    invariant(typeof client.id === "string" && client.id.length > 0, `${desiredClient.clientId} has no id`);

    const attributes = Object.fromEntries(
      Object.entries(client.attributes ?? {}).filter(
        ([attributeName]) => !managedClientAttributeNames.includes(attributeName),
      ),
    );
    for (const attributeName of managedClientAttributeNames) {
      const desiredValue = desiredClient.attributes?.[attributeName];
      if (desiredValue !== undefined) attributes[attributeName] = desiredValue;
    }
    const attributesChanged = managedClientAttributeNames.some(
      (attributeName) => client.attributes?.[attributeName] !== desiredClient.attributes?.[attributeName],
    );
    if (attributesChanged) {
      client = { ...client, attributes };
      await mutate(`admin/realms/${encodedRealm}/clients/${encodePath(client.id)}`, {
        body: client,
        expectedStatuses: [204],
        method: "PUT",
      });
    }

    const defaultPath = `admin/realms/${encodedRealm}/clients/${encodePath(client.id)}/default-client-scopes`;
    const optionalPath = `admin/realms/${encodedRealm}/clients/${encodePath(client.id)}/optional-client-scopes`;
    const linked = {
      default: await request(defaultPath),
      optional: await request(optionalPath),
    };
    for (const [kind, path] of [
      ["default", defaultPath],
      ["optional", optionalPath],
    ]) {
      invariant(
        Array.isArray(linked[kind]),
        `${desiredClient.clientId} ${kind} scopes response was not an array`,
      );
      const expectedNames = new Set(
        (kind === "default" ? desiredClient.defaultClientScopes : desiredClient.optionalClientScopes)?.filter(
          (name) => managedPersonalScopes.has(name),
        ) ?? [],
      );
      const actualNames = new Set(
        linked[kind].filter((scope) => managedPersonalScopes.has(scope?.name)).map((scope) => scope.name),
      );
      for (const scopeName of managedPersonalScopes) {
        if (expectedNames.has(scopeName) === actualNames.has(scopeName)) continue;
        const scope = personalScopes.get(scopeName);
        invariant(scope !== undefined, `Missing managed scope ${scopeName}`);
        await mutate(`${path}/${encodePath(scope.id)}`, {
          expectedStatuses: [204],
          method: expectedNames.has(scopeName) ? "PUT" : "DELETE",
        });
      }
    }
  }

  const profilePath = `admin/realms/${encodedRealm}/client-policies/profiles`;
  const profileRepresentation = await request(profilePath);
  invariant(Array.isArray(profileRepresentation?.profiles), "Client profiles response was invalid");
  const currentProfile = profileRepresentation.profiles.find(
    (profile) => profile?.name === desired.profile.name,
  );
  if (currentProfile === undefined || !matchesTemplate(currentProfile, desired.profile)) {
    await mutate(profilePath, {
      body: {
        profiles: mergeNamedResource(profileRepresentation.profiles, desired.profile),
      },
      expectedStatuses: [200, 204],
      method: "PUT",
    });
  }

  const policyPath = `admin/realms/${encodedRealm}/client-policies/policies`;
  const policyRepresentation = await request(policyPath);
  invariant(Array.isArray(policyRepresentation?.policies), "Client policies response was invalid");
  const currentPolicy = policyRepresentation.policies.find((policy) => policy?.name === desired.policy.name);
  if (currentPolicy === undefined || !matchesTemplate(currentPolicy, desired.policy)) {
    await mutate(policyPath, {
      body: {
        policies: mergeNamedResource(policyRepresentation.policies, desired.policy),
      },
      expectedStatuses: [200, 204],
      method: "PUT",
    });
  }

  await verifyRealm({ desired, request, verifyRevision: false });
  if (realm.attributes?.[revisionAttribute] !== desired.revision) {
    await mutate(`admin/realms/${encodedRealm}`, {
      body: {
        attributes: { ...(realm.attributes ?? {}), [revisionAttribute]: desired.revision },
        realm: desired.realmName,
      },
      expectedStatuses: [204],
      method: "PUT",
    });
  }

  await verifyRealm({ desired, request, verifyRevision: true });
  return { changes, realm: desired.realmName, revision: desired.revision };
}

async function verifyRealm({ desired, request, verifyRevision }) {
  const encodedRealm = encodePath(desired.realmName);
  const realm = await request(`admin/realms/${encodedRealm}`);
  if (verifyRevision) {
    invariant(realm.attributes?.[revisionAttribute] === desired.revision, "Realm revision did not converge");
  }

  const scopes = await request(`admin/realms/${encodedRealm}/client-scopes`);
  for (const desiredScope of desired.scopes) {
    invariant(
      matchesTemplate(
        requiredNamedResource(scopes, desiredScope.name, "Verified client scopes"),
        desiredScope,
      ),
      `${desiredScope.name} verification failed`,
    );
  }

  const profiles = await request(`admin/realms/${encodedRealm}/client-policies/profiles`);
  invariant(
    matchesTemplate(
      requiredNamedResource(profiles?.profiles, desired.profile.name, "Verified client profiles"),
      desired.profile,
    ),
    "Strict DPoP profile verification failed",
  );
  const policies = await request(`admin/realms/${encodedRealm}/client-policies/policies`);
  invariant(
    matchesTemplate(
      requiredNamedResource(policies?.policies, desired.policy.name, "Verified client policies"),
      desired.policy,
    ),
    "Strict DPoP policy verification failed",
  );

  const clients = await request(`admin/realms/${encodedRealm}/clients?max=1000`);
  for (const desiredClient of desired.clients) {
    const clientMatches = clients.filter((client) => client?.clientId === desiredClient.clientId);
    invariant(clientMatches.length === 1, `Verified realm must contain one ${desiredClient.clientId}`);
    const client = clientMatches[0];
    for (const attributeName of managedClientAttributeNames) {
      invariant(
        client.attributes?.[attributeName] === desiredClient.attributes?.[attributeName],
        `${desiredClient.clientId} ${attributeName} did not converge`,
      );
    }
    for (const [kind, desiredNames] of [
      ["default", desiredClient.defaultClientScopes],
      ["optional", desiredClient.optionalClientScopes],
    ]) {
      const linked = await request(
        `admin/realms/${encodedRealm}/clients/${encodePath(client.id)}/${kind}-client-scopes`,
      );
      const expected = [...managedPersonalScopes].filter((scope) => desiredNames?.includes(scope));
      const actual = linked
        .filter((scope) => managedPersonalScopes.has(scope?.name))
        .map((scope) => scope.name)
        .sort();
      invariant(
        JSON.stringify(actual) === JSON.stringify(expected.sort()),
        `${desiredClient.clientId} ${kind} personal scopes did not converge`,
      );
    }
  }
}

function createHttpRequest({ accessToken, baseUrl }) {
  return async (path, { body, expectedStatuses = [200], method = "GET" } = {}) => {
    let response;
    try {
      response = await fetch(new URL(path, baseUrl), {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        method,
        redirect: "error",
        signal: AbortSignal.timeout(requestTimeoutMilliseconds),
      });
    } catch {
      throw new Error(`Admin API ${method} ${path.split("?", 1)[0]} was unreachable`);
    }
    invariant(
      expectedStatuses.includes(response.status),
      `Admin API ${method} ${path.split("?", 1)[0]} returned HTTP ${String(response.status)}`,
    );
    if (method !== "GET" || response.status === 204 || response.headers.get("content-length") === "0") {
      return undefined;
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
    invariant(
      contentType === "application/json",
      `Admin API ${method} ${path.split("?", 1)[0]} returned non-JSON`,
    );
    return response.json();
  };
}

async function authenticate({ baseUrl, password, username }) {
  let response;
  try {
    response = await fetch(new URL("realms/master/protocol/openid-connect/token", baseUrl), {
      body: new URLSearchParams({
        client_id: "admin-cli",
        grant_type: "password",
        password,
        username,
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeoutMilliseconds),
    });
  } catch {
    throw new Error("Keycloak administrator authentication endpoint was unreachable");
  }
  invariant(response.ok, `Keycloak administrator authentication returned HTTP ${String(response.status)}`);
  const result = await response.json();
  invariant(
    typeof result?.access_token === "string" && result.access_token.length > 0,
    "Keycloak administrator authentication returned no token",
  );
  return result.access_token;
}

function createRetainedRealmFixture(desiredRealm) {
  const desired = desiredResources(desiredRealm);
  let idCounter = 100;
  const scopeById = new Map();
  const scopes = desiredRealm.clientScopes
    .filter((scope) => scope.name !== "personal:write")
    .map((scope) => ({ ...structuredClone(scope), id: `scope-${String(idCounter++)}` }));
  const staleRead = scopes.find((scope) => scope.name === "personal:read");
  staleRead.attributes = { "include.in.token.scope": "false" };
  for (const scope of scopes) scopeById.set(scope.id, scope);
  const clients = desiredRealm.clients.map((client) => {
    const copy = structuredClone(client);
    copy.id = `client-${copy.clientId}`;
    copy.attributes ??= {};
    delete copy.attributes["access.token.header.type.rfc9068"];
    delete copy.attributes["dpop.bound.access.tokens"];
    return copy;
  });
  const assignments = new Map(
    clients.map((client) => {
      const defaultNames = new Set(
        (client.defaultClientScopes ?? []).filter((name) => name !== "personal:read"),
      );
      const optionalNames = new Set(
        (client.optionalClientScopes ?? []).filter((name) => name !== "personal:read"),
      );
      if (client.clientId === "gopher-web") optionalNames.delete("personal:write");
      if (client.clientId === "gopher-cli") optionalNames.add("personal:read");
      return [client.id, { default: defaultNames, optional: optionalNames }];
    }),
  );
  const state = {
    clients,
    policies: [],
    profiles: [],
    realm: { attributes: { [revisionAttribute]: "2026-07-01.0" }, realm: desired.realmName },
    scopes,
  };

  const request = async (path, { body, method = "GET" } = {}) => {
    const url = new URL(path, "http://keycloak.invalid/");
    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const resource = segments.slice(3);
    if (resource.length === 0) {
      if (method === "GET") return structuredClone(state.realm);
      if (method === "PUT") {
        state.realm = structuredClone(body);
        return undefined;
      }
    }
    if (resource[0] === "client-scopes") {
      if (resource.length === 1 && method === "GET") return structuredClone(state.scopes);
      if (resource.length === 1 && method === "POST") {
        const scope = { ...structuredClone(body), id: `scope-${String(idCounter++)}` };
        state.scopes.push(scope);
        scopeById.set(scope.id, scope);
        return undefined;
      }
      if (resource.length === 2 && method === "PUT") {
        const index = state.scopes.findIndex((scope) => scope.id === resource[1]);
        invariant(index >= 0, "Fixture scope was not found");
        state.scopes[index] = structuredClone(body);
        scopeById.set(resource[1], state.scopes[index]);
        return undefined;
      }
    }
    if (resource[0] === "clients") {
      if (resource.length === 1 && method === "GET") return structuredClone(state.clients);
      const client = state.clients.find((candidate) => candidate.id === resource[1]);
      invariant(client !== undefined, "Fixture client was not found");
      if (resource.length === 2 && method === "PUT") {
        Object.assign(client, structuredClone(body));
        return undefined;
      }
      const kind = resource[2]?.replace("-client-scopes", "");
      invariant(kind === "default" || kind === "optional", "Fixture scope linkage kind was invalid");
      const linked = assignments.get(client.id)[kind];
      if (resource.length === 3 && method === "GET") {
        return [...linked].map((name) => {
          const scope = state.scopes.find((candidate) => candidate.name === name);
          return scope ?? { id: `built-in-${name}`, name };
        });
      }
      const scope = scopeById.get(resource[3]);
      invariant(scope !== undefined, "Fixture linked scope was not found");
      if (method === "PUT") linked.add(scope.name);
      else if (method === "DELETE") linked.delete(scope.name);
      else invariant(false, "Fixture linkage method was invalid");
      return undefined;
    }
    if (resource[0] === "client-policies" && resource[1] === "profiles") {
      if (method === "GET") return { profiles: structuredClone(state.profiles) };
      state.profiles = structuredClone(body.profiles);
      return undefined;
    }
    if (resource[0] === "client-policies" && resource[1] === "policies") {
      if (method === "GET") return { policies: structuredClone(state.policies) };
      state.policies = structuredClone(body.policies);
      return undefined;
    }
    throw new Error(`Fixture does not implement ${method} ${url.pathname}`);
  };
  return { desired, request, state };
}

async function readDesiredRealm() {
  const path =
    process.env.KEYCLOAK_REALM_EXPORT_PATH ?? fileURLToPath(new URL("./realm-export.json", import.meta.url));
  return JSON.parse(await readFile(path, "utf8"));
}

async function runOfflineSmoke() {
  const desiredRealm = await readDesiredRealm();
  const fixture = createRetainedRealmFixture(desiredRealm);
  const first = await reconcileRealm({ desiredRealm, request: fixture.request });
  invariant(first.changes > 0, "Retained realm fixture required no upgrade");
  const second = await reconcileRealm({ desiredRealm, request: fixture.request });
  invariant(second.changes === 0, "Second reconciliation was not idempotent");
  process.stdout.write(
    `${JSON.stringify({ firstRunChanges: first.changes, realm: first.realm, revision: first.revision, secondRunChanges: second.changes, status: "passed" })}\n`,
  );
}

async function run() {
  if (process.argv.slice(2).includes("--offline-retained-realm-smoke")) {
    await runOfflineSmoke();
    return;
  }
  invariant(process.argv.length === 2, "Unknown reconciler argument");
  const baseUrl = new URL(process.env.KEYCLOAK_BASE_URL ?? "http://keycloak:8080/");
  const baseHostname = baseUrl.hostname.toLowerCase().replace(/^\[(.*)\]$/u, "$1");
  invariant(
    baseUrl.protocol === "https:" ||
      (baseUrl.protocol === "http:" && isPlaintextDevelopmentHost(baseHostname)),
    "KEYCLOAK_BASE_URL must use HTTPS outside the local Compose or loopback boundary",
  );
  invariant(
    baseUrl.username === "" && baseUrl.password === "",
    "KEYCLOAK_BASE_URL must not contain credentials",
  );
  invariant(
    baseUrl.search === "" && baseUrl.hash === "",
    "KEYCLOAK_BASE_URL must not contain a query or fragment",
  );
  const username = process.env.KEYCLOAK_ADMIN;
  const password = process.env.KEYCLOAK_ADMIN_PASSWORD;
  invariant(typeof username === "string" && username.length > 0, "KEYCLOAK_ADMIN is required");
  invariant(typeof password === "string" && password.length > 0, "KEYCLOAK_ADMIN_PASSWORD is required");
  const desiredRealm = await readDesiredRealm();
  const accessToken = await authenticate({ baseUrl, password, username });
  const result = await reconcileRealm({
    desiredRealm,
    request: createHttpRequest({ accessToken, baseUrl }),
  });
  process.stdout.write(`${JSON.stringify({ ...result, status: "reconciled" })}\n`);
}

try {
  await run();
} catch (error) {
  process.stderr.write(
    `Keycloak realm reconciliation failed: ${error instanceof Error ? error.message : "unclassified error"}\n`,
  );
  process.exitCode = 1;
}
