import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

interface Operation {
  operationId?: string;
  security?: { oauth2?: string[] }[];
  "x-runtime-status"?: "contract-only" | "implemented";
}

interface OpenApiDocument {
  components: {
    schemas: {
      RouteProfile: { enum: string[]; type: string };
    };
    securitySchemes: {
      oauth2: {
        description?: string;
        flows: {
          authorizationCode: {
            scopes: Record<string, string>;
            "x-pkce-required"?: boolean;
          };
        };
        "x-device-authorization-url"?: string;
      };
    };
  };
  openapi: string;
  paths: Record<string, Record<string, Operation>>;
  security?: unknown;
}

const openapi = parse(
  readFileSync(resolve(import.meta.dirname, "../../../openapi/openapi.yaml"), "utf8"),
) as OpenApiDocument;

const expectedSecurity = new Map<string, readonly string[]>([
  ["getHealth", []],
  ["listCampuses", []],
  ["listSources", []],
  ["listEvents", []],
  ["listAcademicSessions", []],
  ["listPlaces", []],
  ["calculateRoute", []],
  ["getWorldManifest", []],
  ["listCommunityPosts", []],
  ["createCommunityPost", ["community:write"]],
  ["queryAssistant", ["campus:read"]],
  ["listAcademicCourses", ["campus:read"]],
  ["listMessages", ["messages:read"]],
  ["createMessage", ["messages:write"]],
  ["joinLiveEvent", ["world:write"]],
  ["listModerationCases", ["admin:read"]],
  ["updateSourcePolicy", ["admin:write"]],
]);

function operations(): Operation[] {
  return Object.values(openapi.paths).flatMap((pathItem) =>
    Object.entries(pathItem)
      .filter(([method]) => ["get", "post", "put", "patch", "delete"].includes(method))
      .map(([, operation]) => operation),
  );
}

describe("OpenAPI authorization contract", () => {
  it("uses OpenAPI 3.1 without an implicit global authorization policy", () => {
    expect(openapi.openapi).toBe("3.1.0");
    expect(openapi.security).toBeUndefined();
  });

  it("declares exact, least-privilege security on every operation", () => {
    const found = operations();
    expect(found).toHaveLength(expectedSecurity.size);

    for (const operation of found) {
      expect(operation.operationId).toBeTypeOf("string");
      const expected = expectedSecurity.get(operation.operationId as string);
      expect(expected, `unexpected operation ${operation.operationId}`).toBeDefined();
      expect(operation.security, `missing security for ${operation.operationId}`).toBeDefined();

      if (expected?.length === 0) {
        expect(operation.security).toEqual([]);
      } else {
        expect(operation.security).toEqual([{ oauth2: expected }]);
      }
    }
  });

  it("distinguishes implemented controllers from contract-only surfaces", () => {
    const implemented = operations()
      .filter((operation) => operation["x-runtime-status"] === "implemented")
      .map((operation) => operation.operationId)
      .sort();

    expect(operations().every((operation) => operation["x-runtime-status"] !== undefined)).toBe(true);
    expect(implemented).toEqual(
      [
        "getHealth",
        "getWorldManifest",
        "listAcademicSessions",
        "listCampuses",
        "listEvents",
        "listSources",
      ].sort(),
    );
  });

  it("documents PKCE and the local RFC 8628 endpoint without overstating MCP support", () => {
    const scheme = openapi.components.securitySchemes.oauth2;

    expect(scheme.flows.authorizationCode["x-pkce-required"]).toBe(true);
    expect(scheme["x-device-authorization-url"]).toMatch(/\/auth\/device$/u);
    expect(scheme.description).toMatch(/RFC 8628/u);
    expect(scheme.description).toMatch(/RFC 8707.*not supported/iu);
  });

  it("keeps the first route profile contract to two lowercase modes", () => {
    expect(openapi.components.schemas.RouteProfile).toEqual({
      enum: ["walking", "wheelchair"],
      type: "string",
    });
  });
});
