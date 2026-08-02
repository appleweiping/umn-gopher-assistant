/**
 * Generated from openapi/openapi.yaml. DO NOT EDIT.
 * Run `pnpm --filter @umn-gopher-assistant/sdk generate` after contract changes.
 */

import type { operations } from "./schema.js";

export interface OperationDefinition {
  readonly errorStatuses: readonly number[];
  readonly idempotencyKeyRequired: boolean;
  readonly idempotencyKeyBoundTo: string | null;
  readonly ifMatchRequired: boolean;
  readonly ifNoneMatchRequiredValue: "*" | null;
  readonly ifNoneMatchSupported: boolean;
  readonly maxRequestBodyBytes: number | null;
  readonly maxSuccessResponseBodyBytes: number | null;
  readonly method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  readonly path: string;
  readonly public: boolean;
  readonly queryParameterNames: readonly string[];
  readonly requiredScopes: readonly string[];
  readonly responseRequestBindings: readonly string[];
  readonly runtimeStatus: "contract-only" | "implemented";
  readonly successMediaTypes: readonly string[];
  readonly successStatuses: readonly number[];
  readonly strongIfNoneMatch: boolean;
  readonly supportsNotModified: boolean;
  readonly vaultReadProofRequired: boolean;
}

export const operationDefinitions = {
  "approvePersonalVaultDevicePairing": {
    "errorStatuses": [
      400,
      401,
      403,
      404,
      409,
      412,
      413,
      415,
      428,
      500,
      503
    ],
    "idempotencyKeyRequired": true,
    "idempotencyKeyBoundTo": "command.operationId",
    "ifMatchRequired": true,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": false,
    "maxRequestBodyBytes": 16777216,
    "maxSuccessResponseBodyBytes": 16777216,
    "method": "POST",
    "path": "/v1/personal/vault/device-pairings/{pairingId}/approval",
    "public": false,
    "queryParameterNames": [],
    "requiredScopes": [
      "personal:write"
    ],
    "responseRequestBindings": [],
    "runtimeStatus": "implemented",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": false,
    "vaultReadProofRequired": false
  },
  "bootstrapPersonalVault": {
    "errorStatuses": [
      401,
      403,
      404,
      500,
      503
    ],
    "idempotencyKeyRequired": false,
    "idempotencyKeyBoundTo": null,
    "ifMatchRequired": false,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": false,
    "maxRequestBodyBytes": null,
    "maxSuccessResponseBodyBytes": null,
    "method": "GET",
    "path": "/v1/personal/vault/bootstrap",
    "public": false,
    "queryParameterNames": [],
    "requiredScopes": [
      "personal:read"
    ],
    "responseRequestBindings": [],
    "runtimeStatus": "implemented",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": false,
    "vaultReadProofRequired": false
  },
  "calculateRoute": {
    "errorStatuses": [
      400,
      409,
      422,
      503
    ],
    "idempotencyKeyRequired": true,
    "idempotencyKeyBoundTo": null,
    "ifMatchRequired": false,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": false,
    "maxRequestBodyBytes": null,
    "maxSuccessResponseBodyBytes": null,
    "method": "POST",
    "path": "/v1/routes",
    "public": true,
    "queryParameterNames": [],
    "requiredScopes": [],
    "responseRequestBindings": [],
    "runtimeStatus": "contract-only",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": false,
    "vaultReadProofRequired": false
  },
  "cancelPersonalVaultDevicePairing": {
    "errorStatuses": [
      400,
      401,
      403,
      404,
      409,
      412,
      428,
      500,
      503
    ],
    "idempotencyKeyRequired": true,
    "idempotencyKeyBoundTo": null,
    "ifMatchRequired": true,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": false,
    "maxRequestBodyBytes": null,
    "maxSuccessResponseBodyBytes": null,
    "method": "DELETE",
    "path": "/v1/personal/vault/device-pairings/{pairingId}",
    "public": false,
    "queryParameterNames": [],
    "requiredScopes": [
      "personal:write"
    ],
    "responseRequestBindings": [],
    "runtimeStatus": "implemented",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": false,
    "vaultReadProofRequired": false
  },
  "createCommunityPost": {
    "errorStatuses": [
      400,
      401,
      409,
      422,
      429
    ],
    "idempotencyKeyRequired": true,
    "idempotencyKeyBoundTo": null,
    "ifMatchRequired": false,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": false,
    "maxRequestBodyBytes": null,
    "maxSuccessResponseBodyBytes": null,
    "method": "POST",
    "path": "/v1/community/posts",
    "public": false,
    "queryParameterNames": [],
    "requiredScopes": [
      "community:write"
    ],
    "responseRequestBindings": [],
    "runtimeStatus": "contract-only",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      201
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": false,
    "vaultReadProofRequired": false
  },
  "createMessage": {
    "errorStatuses": [
      400,
      401,
      403,
      409,
      422,
      429
    ],
    "idempotencyKeyRequired": true,
    "idempotencyKeyBoundTo": null,
    "ifMatchRequired": false,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": false,
    "maxRequestBodyBytes": null,
    "maxSuccessResponseBodyBytes": null,
    "method": "POST",
    "path": "/v1/messages",
    "public": false,
    "queryParameterNames": [],
    "requiredScopes": [
      "messages:write"
    ],
    "responseRequestBindings": [],
    "runtimeStatus": "contract-only",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      201
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": false,
    "vaultReadProofRequired": false
  },
  "createPersonalVault": {
    "errorStatuses": [
      400,
      401,
      403,
      404,
      409,
      412,
      413,
      415,
      428,
      500,
      503
    ],
    "idempotencyKeyRequired": true,
    "idempotencyKeyBoundTo": "operationId",
    "ifMatchRequired": false,
    "ifNoneMatchRequiredValue": "*",
    "ifNoneMatchSupported": true,
    "maxRequestBodyBytes": 16777216,
    "maxSuccessResponseBodyBytes": 16777216,
    "method": "POST",
    "path": "/v1/personal/vault",
    "public": false,
    "queryParameterNames": [],
    "requiredScopes": [
      "personal:write"
    ],
    "responseRequestBindings": [],
    "runtimeStatus": "implemented",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      201
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": false,
    "vaultReadProofRequired": false
  },
  "createPersonalVaultDevicePairing": {
    "errorStatuses": [
      400,
      401,
      403,
      404,
      409,
      412,
      413,
      415,
      428,
      500,
      503
    ],
    "idempotencyKeyRequired": true,
    "idempotencyKeyBoundTo": "operationId",
    "ifMatchRequired": true,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": false,
    "maxRequestBodyBytes": 16777216,
    "maxSuccessResponseBodyBytes": null,
    "method": "POST",
    "path": "/v1/personal/vault/device-pairings",
    "public": false,
    "queryParameterNames": [],
    "requiredScopes": [
      "personal:write"
    ],
    "responseRequestBindings": [],
    "runtimeStatus": "implemented",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      201
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": false,
    "vaultReadProofRequired": false
  },
  "getHealth": {
    "errorStatuses": [
      500
    ],
    "idempotencyKeyRequired": false,
    "idempotencyKeyBoundTo": null,
    "ifMatchRequired": false,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": false,
    "maxRequestBodyBytes": null,
    "maxSuccessResponseBodyBytes": null,
    "method": "GET",
    "path": "/v1/health",
    "public": true,
    "queryParameterNames": [],
    "requiredScopes": [],
    "responseRequestBindings": [],
    "runtimeStatus": "implemented",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": false,
    "vaultReadProofRequired": false
  },
  "getWorldManifest": {
    "errorStatuses": [
      404,
      500
    ],
    "idempotencyKeyRequired": false,
    "idempotencyKeyBoundTo": null,
    "ifMatchRequired": false,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": true,
    "maxRequestBodyBytes": null,
    "maxSuccessResponseBodyBytes": null,
    "method": "GET",
    "path": "/v1/worlds/{campusId}/manifest",
    "public": true,
    "queryParameterNames": [],
    "requiredScopes": [],
    "responseRequestBindings": [],
    "runtimeStatus": "implemented",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": true,
    "vaultReadProofRequired": false
  },
  "joinLiveEvent": {
    "errorStatuses": [
      400,
      401,
      403,
      404,
      409,
      422,
      429
    ],
    "idempotencyKeyRequired": true,
    "idempotencyKeyBoundTo": null,
    "ifMatchRequired": false,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": false,
    "maxRequestBodyBytes": null,
    "maxSuccessResponseBodyBytes": null,
    "method": "POST",
    "path": "/v1/live-events/{eventId}/join",
    "public": false,
    "queryParameterNames": [],
    "requiredScopes": [
      "world:write"
    ],
    "responseRequestBindings": [],
    "runtimeStatus": "contract-only",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": false,
    "vaultReadProofRequired": false
  },
  "listAcademicCourses": {
    "errorStatuses": [
      400,
      401,
      403,
      503
    ],
    "idempotencyKeyRequired": false,
    "idempotencyKeyBoundTo": null,
    "ifMatchRequired": false,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": true,
    "maxRequestBodyBytes": null,
    "maxSuccessResponseBodyBytes": null,
    "method": "GET",
    "path": "/v1/academics/courses",
    "public": false,
    "queryParameterNames": [
      "academicInstitutionCode",
      "campusId",
      "cursor",
      "limit"
    ],
    "requiredScopes": [
      "campus:read"
    ],
    "responseRequestBindings": [],
    "runtimeStatus": "contract-only",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": true,
    "vaultReadProofRequired": false
  },
  "listAcademicSessions": {
    "errorStatuses": [
      400,
      410,
      500,
      503
    ],
    "idempotencyKeyRequired": false,
    "idempotencyKeyBoundTo": null,
    "ifMatchRequired": false,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": true,
    "maxRequestBodyBytes": null,
    "maxSuccessResponseBodyBytes": null,
    "method": "GET",
    "path": "/v1/academics/sessions",
    "public": true,
    "queryParameterNames": [
      "campusId",
      "cursor",
      "from",
      "limit",
      "to"
    ],
    "requiredScopes": [],
    "responseRequestBindings": [],
    "runtimeStatus": "implemented",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": true,
    "vaultReadProofRequired": false
  },
  "listCampuses": {
    "errorStatuses": [
      500
    ],
    "idempotencyKeyRequired": false,
    "idempotencyKeyBoundTo": null,
    "ifMatchRequired": false,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": true,
    "maxRequestBodyBytes": null,
    "maxSuccessResponseBodyBytes": null,
    "method": "GET",
    "path": "/v1/campuses",
    "public": true,
    "queryParameterNames": [],
    "requiredScopes": [],
    "responseRequestBindings": [],
    "runtimeStatus": "implemented",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": true,
    "vaultReadProofRequired": false
  },
  "listCommunityPosts": {
    "errorStatuses": [
      400,
      401
    ],
    "idempotencyKeyRequired": false,
    "idempotencyKeyBoundTo": null,
    "ifMatchRequired": false,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": false,
    "maxRequestBodyBytes": null,
    "maxSuccessResponseBodyBytes": null,
    "method": "GET",
    "path": "/v1/community/posts",
    "public": true,
    "queryParameterNames": [
      "campusId",
      "cursor",
      "limit"
    ],
    "requiredScopes": [],
    "responseRequestBindings": [],
    "runtimeStatus": "contract-only",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": false,
    "vaultReadProofRequired": false
  },
  "listEvents": {
    "errorStatuses": [
      400,
      410,
      500,
      503
    ],
    "idempotencyKeyRequired": false,
    "idempotencyKeyBoundTo": null,
    "ifMatchRequired": false,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": true,
    "maxRequestBodyBytes": null,
    "maxSuccessResponseBodyBytes": null,
    "method": "GET",
    "path": "/v1/events",
    "public": true,
    "queryParameterNames": [
      "campusId",
      "cursor",
      "from",
      "limit",
      "to"
    ],
    "requiredScopes": [],
    "responseRequestBindings": [],
    "runtimeStatus": "implemented",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": true,
    "vaultReadProofRequired": false
  },
  "listMessages": {
    "errorStatuses": [
      400,
      401,
      403
    ],
    "idempotencyKeyRequired": false,
    "idempotencyKeyBoundTo": null,
    "ifMatchRequired": false,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": true,
    "maxRequestBodyBytes": null,
    "maxSuccessResponseBodyBytes": null,
    "method": "GET",
    "path": "/v1/messages",
    "public": false,
    "queryParameterNames": [
      "cursor",
      "limit"
    ],
    "requiredScopes": [
      "messages:read"
    ],
    "responseRequestBindings": [],
    "runtimeStatus": "contract-only",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": true,
    "vaultReadProofRequired": false
  },
  "listModerationCases": {
    "errorStatuses": [
      400,
      401,
      403
    ],
    "idempotencyKeyRequired": false,
    "idempotencyKeyBoundTo": null,
    "ifMatchRequired": false,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": false,
    "maxRequestBodyBytes": null,
    "maxSuccessResponseBodyBytes": null,
    "method": "GET",
    "path": "/v1/moderation/cases",
    "public": false,
    "queryParameterNames": [
      "cursor",
      "limit"
    ],
    "requiredScopes": [
      "admin:read"
    ],
    "responseRequestBindings": [],
    "runtimeStatus": "contract-only",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": false,
    "vaultReadProofRequired": false
  },
  "listPersonalVaultDevicePairings": {
    "errorStatuses": [
      400,
      401,
      403,
      404,
      500,
      503
    ],
    "idempotencyKeyRequired": false,
    "idempotencyKeyBoundTo": null,
    "ifMatchRequired": false,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": true,
    "maxRequestBodyBytes": null,
    "maxSuccessResponseBodyBytes": null,
    "method": "GET",
    "path": "/v1/personal/vault/device-pairings",
    "public": false,
    "queryParameterNames": [],
    "requiredScopes": [
      "personal:read"
    ],
    "responseRequestBindings": [],
    "runtimeStatus": "implemented",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "strongIfNoneMatch": true,
    "supportsNotModified": true,
    "vaultReadProofRequired": false
  },
  "listPlaces": {
    "errorStatuses": [
      400,
      503
    ],
    "idempotencyKeyRequired": false,
    "idempotencyKeyBoundTo": null,
    "ifMatchRequired": false,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": true,
    "maxRequestBodyBytes": null,
    "maxSuccessResponseBodyBytes": null,
    "method": "GET",
    "path": "/v1/places",
    "public": true,
    "queryParameterNames": [
      "campusId",
      "cursor",
      "limit",
      "query"
    ],
    "requiredScopes": [],
    "responseRequestBindings": [],
    "runtimeStatus": "contract-only",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": true,
    "vaultReadProofRequired": false
  },
  "listSources": {
    "errorStatuses": [
      400,
      500
    ],
    "idempotencyKeyRequired": false,
    "idempotencyKeyBoundTo": null,
    "ifMatchRequired": false,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": true,
    "maxRequestBodyBytes": null,
    "maxSuccessResponseBodyBytes": null,
    "method": "GET",
    "path": "/v1/sources",
    "public": true,
    "queryParameterNames": [
      "campusId",
      "cursor",
      "limit"
    ],
    "requiredScopes": [],
    "responseRequestBindings": [],
    "runtimeStatus": "implemented",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": true,
    "vaultReadProofRequired": false
  },
  "queryCampusAssistant": {
    "errorStatuses": [
      400,
      413,
      415,
      429,
      500,
      503
    ],
    "idempotencyKeyRequired": false,
    "idempotencyKeyBoundTo": null,
    "ifMatchRequired": false,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": false,
    "maxRequestBodyBytes": null,
    "maxSuccessResponseBodyBytes": null,
    "method": "POST",
    "path": "/v1/ai/query",
    "public": true,
    "queryParameterNames": [],
    "requiredScopes": [],
    "responseRequestBindings": [
      "campusId",
      "locale"
    ],
    "runtimeStatus": "implemented",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": false,
    "vaultReadProofRequired": false
  },
  "readPersonalVault": {
    "errorStatuses": [
      400,
      401,
      403,
      404,
      428,
      500,
      503
    ],
    "idempotencyKeyRequired": false,
    "idempotencyKeyBoundTo": null,
    "ifMatchRequired": false,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": true,
    "maxRequestBodyBytes": null,
    "maxSuccessResponseBodyBytes": 16777216,
    "method": "GET",
    "path": "/v1/personal/vault",
    "public": false,
    "queryParameterNames": [],
    "requiredScopes": [
      "personal:read"
    ],
    "responseRequestBindings": [],
    "runtimeStatus": "implemented",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "strongIfNoneMatch": true,
    "supportsNotModified": true,
    "vaultReadProofRequired": true
  },
  "rotatePersonalVaultKey": {
    "errorStatuses": [
      400,
      401,
      403,
      404,
      409,
      412,
      413,
      415,
      428,
      500,
      503
    ],
    "idempotencyKeyRequired": true,
    "idempotencyKeyBoundTo": "operationId",
    "ifMatchRequired": true,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": false,
    "maxRequestBodyBytes": 16777216,
    "maxSuccessResponseBodyBytes": 16777216,
    "method": "POST",
    "path": "/v1/personal/vault/rotations",
    "public": false,
    "queryParameterNames": [],
    "requiredScopes": [
      "personal:write"
    ],
    "responseRequestBindings": [],
    "runtimeStatus": "implemented",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": false,
    "vaultReadProofRequired": false
  },
  "updatePersonalVaultPayload": {
    "errorStatuses": [
      400,
      401,
      403,
      404,
      409,
      412,
      413,
      415,
      428,
      500,
      503
    ],
    "idempotencyKeyRequired": true,
    "idempotencyKeyBoundTo": "operationId",
    "ifMatchRequired": true,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": false,
    "maxRequestBodyBytes": 16777216,
    "maxSuccessResponseBodyBytes": 16777216,
    "method": "PUT",
    "path": "/v1/personal/vault/payload",
    "public": false,
    "queryParameterNames": [],
    "requiredScopes": [
      "personal:write"
    ],
    "responseRequestBindings": [],
    "runtimeStatus": "implemented",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": false,
    "vaultReadProofRequired": false
  },
  "updateSourcePolicy": {
    "errorStatuses": [
      400,
      401,
      403,
      404,
      409,
      422
    ],
    "idempotencyKeyRequired": true,
    "idempotencyKeyBoundTo": null,
    "ifMatchRequired": false,
    "ifNoneMatchRequiredValue": null,
    "ifNoneMatchSupported": false,
    "maxRequestBodyBytes": null,
    "maxSuccessResponseBodyBytes": null,
    "method": "PATCH",
    "path": "/v1/admin/sources/{sourceId}",
    "public": false,
    "queryParameterNames": [],
    "requiredScopes": [
      "admin:write"
    ],
    "responseRequestBindings": [],
    "runtimeStatus": "contract-only",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "strongIfNoneMatch": false,
    "supportsNotModified": false,
    "vaultReadProofRequired": false
  }
} as const satisfies Record<keyof operations, OperationDefinition>;

export type OperationId = keyof typeof operationDefinitions;
