import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { operationDefinitions } from "../src/generated/operations.js";
import {
  successValidatorContractSha256,
  validateImplementedSuccessBody,
} from "../src/generated/validators.js";

interface GeneratorModule {
  readonly contractSourceSha256: (source: string) => string;
  readonly generateValidatorArtifact: (contractSource: string) => Promise<string>;
  readonly normalizeContractSource: (source: string) => string;
}

const { contractSourceSha256, generateValidatorArtifact, normalizeContractSource } = (await import(
  new URL("../scripts/generator.mjs", import.meta.url).href
)) as unknown as GeneratorModule;

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
    expect(operationDefinitions.getHealth.queryParameterNames).toEqual([]);
    expect(operationDefinitions.listSources.queryParameterNames).toEqual(["campusId", "cursor", "limit"]);
    expect(operationDefinitions.listAcademicCourses.queryParameterNames).toEqual([
      "academicInstitutionCode",
      "campusId",
      "cursor",
      "limit",
    ]);
  });

  it("marks generated files as derived from the shared contract", () => {
    for (const file of ["schema.ts", "operations.ts", "validators.ts"]) {
      const source = readFileSync(resolve(import.meta.dirname, `../src/generated/${file}`), "utf8");
      expect(source).toContain("openapi/openapi.yaml");
      expect(source).toContain("DO NOT EDIT");
    }
  });

  it("fingerprints the complete contract so validator generation drift fails tests", () => {
    const contract = readFileSync(resolve(import.meta.dirname, "../../../openapi/openapi.yaml"), "utf8");
    expect(successValidatorContractSha256).toBe(contractSourceSha256(contract));
  });

  it("produces the same validator and fingerprint for LF and CRLF contracts", async () => {
    const contract = readFileSync(resolve(import.meta.dirname, "../../../openapi/openapi.yaml"), "utf8");
    const lfContract = normalizeContractSource(contract);
    const crlfContract = lfContract.replaceAll("\n", "\r\n");

    expect(crlfContract).not.toBe(lfContract);
    expect(contractSourceSha256(crlfContract)).toBe(contractSourceSha256(lfContract));
    const [lfValidator, crlfValidator] = await Promise.all([
      generateValidatorArtifact(lfContract),
      generateValidatorArtifact(crlfContract),
    ]);
    expect(crlfValidator).toBe(lfValidator);
    expect(lfValidator).toContain(
      `successValidatorContractSha256 =\n  "${contractSourceSha256(lfContract)}"`,
    );
  });

  it("exposes stable public validation results for implemented operations and statuses", () => {
    const health = {
      service: "campus-api",
      status: "ok",
      time: "2026-07-19T12:00:00-05:00",
      version: "0.1.0",
    };
    expect(validateImplementedSuccessBody("getHealth", 200, health)).toEqual({
      data: health,
      success: true,
    });
    expect(validateImplementedSuccessBody("getHealth", 201, health)).toEqual({
      reason: "unexpected-success-status",
      success: false,
    });
    expect(validateImplementedSuccessBody("listEvents", 200, {})).toEqual({
      reason: "operation-not-implemented",
      success: false,
    });
    expect(validateImplementedSuccessBody("getHealth", 200, {})).toEqual({
      reason: "invalid-success-body",
      success: false,
    });
  });
});
