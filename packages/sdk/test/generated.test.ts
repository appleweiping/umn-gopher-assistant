import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { operationDefinitions } from "../src/generated/operations.js";

describe("OpenAPI generated artifacts", () => {
  it("contains every current operation and its runtime transport data", () => {
    expect(Object.keys(operationDefinitions).sort()).toEqual(
      [
        "calculateRoute",
        "createCommunityPost",
        "createMessage",
        "getHealth",
        "getWorldManifest",
        "joinLiveEvent",
        "listAcademicCourses",
        "listCampuses",
        "listCommunityPosts",
        "listEvents",
        "listMessages",
        "listModerationCases",
        "listPlaces",
        "listSources",
        "queryAssistant",
        "updateSourcePolicy",
      ].sort(),
    );
    expect(operationDefinitions.createCommunityPost).toMatchObject({
      method: "POST",
      path: "/v1/community/posts",
      runtimeStatus: "contract-only",
    });
    expect(operationDefinitions.getHealth.runtimeStatus).toBe("implemented");
  });

  it("marks generated files as derived from the shared contract", () => {
    for (const file of ["schema.ts", "operations.ts"]) {
      const source = readFileSync(resolve(import.meta.dirname, `../src/generated/${file}`), "utf8");
      expect(source).toContain("openapi/openapi.yaml");
      expect(source).toContain("DO NOT EDIT");
    }
  });
});
