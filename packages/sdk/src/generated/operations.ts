/**
 * Generated from openapi/openapi.yaml. DO NOT EDIT.
 * Run `pnpm --filter @umn-gopher-assistant/sdk generate` after contract changes.
 */

import type { operations } from "./schema.js";

export interface OperationDefinition {
  readonly idempotencyKeyRequired: boolean;
  readonly method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  readonly path: string;
  readonly public: boolean;
  readonly requiredScopes: readonly string[];
  readonly runtimeStatus: "contract-only" | "implemented";
  readonly successMediaTypes: readonly string[];
  readonly successStatuses: readonly number[];
  readonly supportsNotModified: boolean;
}

export const operationDefinitions = {
  "calculateRoute": {
    "idempotencyKeyRequired": true,
    "method": "POST",
    "path": "/v1/routes",
    "public": true,
    "requiredScopes": [],
    "runtimeStatus": "contract-only",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "supportsNotModified": false
  },
  "createCommunityPost": {
    "idempotencyKeyRequired": true,
    "method": "POST",
    "path": "/v1/community/posts",
    "public": false,
    "requiredScopes": [
      "community:write"
    ],
    "runtimeStatus": "contract-only",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      201
    ],
    "supportsNotModified": false
  },
  "createMessage": {
    "idempotencyKeyRequired": true,
    "method": "POST",
    "path": "/v1/messages",
    "public": false,
    "requiredScopes": [
      "messages:write"
    ],
    "runtimeStatus": "contract-only",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      201
    ],
    "supportsNotModified": false
  },
  "getHealth": {
    "idempotencyKeyRequired": false,
    "method": "GET",
    "path": "/v1/health",
    "public": true,
    "requiredScopes": [],
    "runtimeStatus": "implemented",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "supportsNotModified": false
  },
  "getWorldManifest": {
    "idempotencyKeyRequired": false,
    "method": "GET",
    "path": "/v1/worlds/{campusId}/manifest",
    "public": true,
    "requiredScopes": [],
    "runtimeStatus": "implemented",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "supportsNotModified": true
  },
  "joinLiveEvent": {
    "idempotencyKeyRequired": true,
    "method": "POST",
    "path": "/v1/live-events/{eventId}/join",
    "public": false,
    "requiredScopes": [
      "world:write"
    ],
    "runtimeStatus": "contract-only",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "supportsNotModified": false
  },
  "listAcademicCourses": {
    "idempotencyKeyRequired": false,
    "method": "GET",
    "path": "/v1/academics/courses",
    "public": false,
    "requiredScopes": [
      "campus:read"
    ],
    "runtimeStatus": "contract-only",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "supportsNotModified": true
  },
  "listCampuses": {
    "idempotencyKeyRequired": false,
    "method": "GET",
    "path": "/v1/campuses",
    "public": true,
    "requiredScopes": [],
    "runtimeStatus": "implemented",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "supportsNotModified": true
  },
  "listCommunityPosts": {
    "idempotencyKeyRequired": false,
    "method": "GET",
    "path": "/v1/community/posts",
    "public": true,
    "requiredScopes": [],
    "runtimeStatus": "contract-only",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "supportsNotModified": false
  },
  "listEvents": {
    "idempotencyKeyRequired": false,
    "method": "GET",
    "path": "/v1/events",
    "public": true,
    "requiredScopes": [],
    "runtimeStatus": "contract-only",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "supportsNotModified": true
  },
  "listMessages": {
    "idempotencyKeyRequired": false,
    "method": "GET",
    "path": "/v1/messages",
    "public": false,
    "requiredScopes": [
      "messages:read"
    ],
    "runtimeStatus": "contract-only",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "supportsNotModified": true
  },
  "listModerationCases": {
    "idempotencyKeyRequired": false,
    "method": "GET",
    "path": "/v1/moderation/cases",
    "public": false,
    "requiredScopes": [
      "admin:read"
    ],
    "runtimeStatus": "contract-only",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "supportsNotModified": false
  },
  "listPlaces": {
    "idempotencyKeyRequired": false,
    "method": "GET",
    "path": "/v1/places",
    "public": true,
    "requiredScopes": [],
    "runtimeStatus": "contract-only",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "supportsNotModified": true
  },
  "listSources": {
    "idempotencyKeyRequired": false,
    "method": "GET",
    "path": "/v1/sources",
    "public": true,
    "requiredScopes": [],
    "runtimeStatus": "implemented",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "supportsNotModified": true
  },
  "queryAssistant": {
    "idempotencyKeyRequired": true,
    "method": "POST",
    "path": "/v1/ai/query",
    "public": false,
    "requiredScopes": [
      "campus:read"
    ],
    "runtimeStatus": "contract-only",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "supportsNotModified": false
  },
  "updateSourcePolicy": {
    "idempotencyKeyRequired": true,
    "method": "PATCH",
    "path": "/v1/admin/sources/{sourceId}",
    "public": false,
    "requiredScopes": [
      "admin:write"
    ],
    "runtimeStatus": "contract-only",
    "successMediaTypes": [
      "application/json"
    ],
    "successStatuses": [
      200
    ],
    "supportsNotModified": false
  }
} as const satisfies Record<keyof operations, OperationDefinition>;

export type OperationId = keyof typeof operationDefinitions;
