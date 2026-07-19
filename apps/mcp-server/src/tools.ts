import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  GopherApiError,
  GopherClient,
  GopherProtocolError,
  operationDefinitions,
} from "@umn-gopher-assistant/sdk";
import type { OperationDefinition, OperationId } from "@umn-gopher-assistant/sdk";
import { z } from "zod";

const campusIdSchema = z.enum(["tc", "duluth", "crookston", "morris", "rochester"]);
const bilingualTextSchema = z.object({ en: z.string().min(1), "zh-CN": z.string().min(1) }).strict();
const dateTimeSchema = z.iso.datetime({ offset: true });
const httpsUrlSchema = z.url().regex(/^https:\/\//u);
const requestIdSchema = z.string().min(8).max(128).nullable();
const licenseStatusSchema = z.enum([
  "OPEN_REUSE",
  "LIVE_ONLY",
  "DEEPLINK_ONLY",
  "APPROVAL_REQUIRED",
  "PROHIBITED",
]);
const freshnessStateSchema = z.enum(["FRESH", "STALE", "EXPIRED", "UNKNOWN"]);
const verificationStateSchema = z.enum(["schematic", "surveyed", "campus-reviewed", "verified", "retired"]);
const officialStatusSchema = z.enum(["UNVERIFIED", "PUBLISHER_ASSERTED", "PARTNERSHIP_VERIFIED"]);

const campusSchema = z
  .object({
    academicCalendarCampusId: campusIdSchema,
    academicInstitutionCode: z.enum(["UMNTC", "UMNDL", "UMNCR", "UMNMO"]),
    city: bilingualTextSchema,
    id: campusIdSchema,
    name: bilingualTextSchema,
    officialStatus: officialStatusSchema,
    sourceUrl: httpsUrlSchema,
    timeZone: z.string(),
  })
  .strict();

const sourceDescriptorSchema = z
  .object({
    attribution: z.string().min(1),
    cachePolicy: z.enum(["CACHE_ALLOWED", "METADATA_ONLY", "NO_CONTENT_CACHE", "NO_ACCESS"]),
    campusIds: z.array(campusIdSchema).min(1),
    freshnessState: freshnessStateSchema,
    id: z.string(),
    lastCheckedAt: dateTimeSchema.nullable(),
    licenseStatus: licenseStatusSchema,
    name: bilingualTextSchema,
    officialStatus: officialStatusSchema,
    publisher: z.string(),
    sourceUrl: httpsUrlSchema,
    verificationState: verificationStateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.licenseStatus === "PROHIBITED" && value.cachePolicy !== "NO_ACCESS") {
      context.addIssue({
        code: "custom",
        message: "PROHIBITED sources must use NO_ACCESS",
        path: ["cachePolicy"],
      });
    }
  });
const sourcePageSchema = z
  .object({
    items: z.array(sourceDescriptorSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

const worldTileSchema = z
  .object({
    bounds: z.array(z.number()).length(4),
    byteLength: z.number().int().positive(),
    contentType: z.string(),
    id: z.string(),
    licenseStatus: licenseStatusSchema,
    maxZoom: z.number().int().min(0).max(24),
    minZoom: z.number().int().min(0).max(24),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    url: z.url(),
    verificationState: verificationStateSchema,
  })
  .strict();

const worldPortalSchema = z
  .object({
    fromCampusId: campusIdSchema,
    id: z.string(),
    label: bilingualTextSchema,
    position: z.array(z.number()).length(3),
    targetWorldVersion: z.string(),
    toCampusId: campusIdSchema,
    verificationState: verificationStateSchema,
  })
  .strict();

const worldManifestSchema = z
  .object({
    campusId: campusIdSchema,
    etag: z.string(),
    generatedAt: dateTimeSchema,
    portals: z.array(worldPortalSchema),
    revision: z.number().int().positive(),
    sourceIds: z.array(z.string()).min(1),
    tiles: z.array(worldTileSchema),
    verificationState: verificationStateSchema,
    worldVersion: z.string(),
  })
  .strict();

const campusesOutputShape = {
  campuses: z.array(campusSchema),
  etag: z.string().nullable(),
  requestId: requestIdSchema,
};

const sourcesOutputShape = {
  etag: z.string().nullable(),
  nextCursor: z.string().nullable(),
  requestId: requestIdSchema,
  sources: z.array(sourceDescriptorSchema),
};

const worldManifestOutputShape = {
  etag: z.string().nullable(),
  manifest: worldManifestSchema,
  requestId: requestIdSchema,
};

export type McpToolName = "campuses_list" | "sources_list" | "world_manifest_get";

export interface McpToolCatalogEntry {
  readonly annotations: {
    readonly destructiveHint: false;
    readonly idempotentHint: true;
    readonly openWorldHint: true;
    readonly readOnlyHint: true;
  };
  readonly description: string;
  readonly name: McpToolName;
  readonly operationId: "getWorldManifest" | "listCampuses" | "listSources";
  readonly title: string;
}

const annotations = Object.freeze({
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
  readOnlyHint: true,
} as const);

export const MCP_TOOL_CATALOG = Object.freeze([
  Object.freeze({
    annotations,
    description:
      "List the five supported campuses and their academic-calendar mappings. Returns neutral, provenance-linked campus records.",
    name: "campuses_list",
    operationId: "listCampuses",
    title: "List campuses",
  }),
  Object.freeze({
    annotations,
    description:
      "List campus data-source descriptors with license, caching, freshness, and verification state. Supports campus and cursor filters.",
    name: "sources_list",
    operationId: "listSources",
    title: "List campus sources",
  }),
  Object.freeze({
    annotations,
    description:
      "Get the versioned world manifest for one campus, including schematic or verification status, content hashes, tiles, and portals.",
    name: "world_manifest_get",
    operationId: "getWorldManifest",
    title: "Get campus world manifest",
  }),
] as const satisfies readonly McpToolCatalogEntry[]);

const expectedOperationIds = new Set<OperationId>(["getWorldManifest", "listCampuses", "listSources"]);
const runtimeOperationDefinitions: Readonly<Record<string, OperationDefinition | undefined>> =
  operationDefinitions;

for (const entry of MCP_TOOL_CATALOG) {
  const definition = runtimeOperationDefinitions[entry.operationId];
  if (
    definition === undefined ||
    !expectedOperationIds.has(entry.operationId) ||
    definition.runtimeStatus !== "implemented" ||
    !definition.public ||
    definition.method !== "GET" ||
    definition.requiredScopes.length !== 0
  ) {
    throw new Error(`MCP tool ${entry.name} is not backed by an implemented public GET operation`);
  }
}

export interface McpToolServiceOptions {
  readonly apiBaseUrl: URL;
  readonly fetch?: typeof fetch;
  readonly upstreamTimeoutMs: number;
}

type PublicToolErrorCode =
  | "cancelled"
  | "invalid_request"
  | "not_found"
  | "rate_limited"
  | "upstream_protocol_error"
  | "upstream_unavailable";

class UpstreamShapeError extends Error {
  constructor() {
    super("Upstream response failed the public output contract");
    this.name = "UpstreamShapeError";
  }
}

function parseStrictUpstream<Schema extends z.ZodType>(schema: Schema, value: unknown): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new UpstreamShapeError();
  return parsed.data;
}

function publicToolFailure(code: PublicToolErrorCode, message: string, retryable: boolean): CallToolResult {
  const structuredContent = { error: { code, message, retryable } };
  return {
    content: [{ text: JSON.stringify(structuredContent), type: "text" }],
    isError: true,
    structuredContent,
  };
}

function mapToolError(error: unknown): CallToolResult {
  if (error instanceof GopherApiError) {
    if (error.status === 400 || error.status === 422) {
      return publicToolFailure("invalid_request", "The campus API rejected the request.", false);
    }
    if (error.status === 404) {
      return publicToolFailure("not_found", "The requested campus resource was not found.", false);
    }
    if (error.status === 429) {
      return publicToolFailure("rate_limited", "The campus API is temporarily rate limited.", true);
    }
    return publicToolFailure("upstream_unavailable", "The campus API is temporarily unavailable.", true);
  }
  if (error instanceof GopherProtocolError) {
    return publicToolFailure("upstream_protocol_error", "The campus API returned an invalid response.", true);
  }
  if (error instanceof UpstreamShapeError) {
    return publicToolFailure("upstream_protocol_error", "The campus API returned an invalid response.", true);
  }
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return publicToolFailure("cancelled", "The campus API request was cancelled or timed out.", true);
  }
  return publicToolFailure("upstream_unavailable", "The campus API request could not be completed.", true);
}

function createRequestSignal(
  parent: AbortSignal,
  timeoutMs: number,
): {
  readonly cleanup: () => void;
  readonly signal: AbortSignal;
} {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parent.reason);
  if (parent.aborted) abortFromParent();
  else parent.addEventListener("abort", abortFromParent, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Timed out", "TimeoutError")),
    timeoutMs,
  );
  timeout.unref();
  return {
    cleanup: () => {
      clearTimeout(timeout);
      parent.removeEventListener("abort", abortFromParent);
    },
    signal: controller.signal,
  };
}

export class McpToolService {
  readonly #client: GopherClient;
  readonly #upstreamTimeoutMs: number;

  constructor(options: McpToolServiceOptions) {
    const upstreamFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    const guardedFetch: typeof fetch = async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.headers.has("authorization")) {
        throw new Error("Invariant violation: the public downstream request contained Authorization");
      }
      return upstreamFetch(request);
    };
    this.#client = new GopherClient({ baseUrl: options.apiBaseUrl, fetch: guardedFetch });
    this.#upstreamTimeoutMs = options.upstreamTimeoutMs;
  }

  async listCampuses(signal: AbortSignal): Promise<CallToolResult> {
    const request = createRequestSignal(signal, this.#upstreamTimeoutMs);
    try {
      const result = await this.#client.request("listCampuses", { signal: request.signal });
      if (result.notModified) throw new Error("Unexpected not-modified response");
      const campuses = parseStrictUpstream(z.array(campusSchema), result.data);
      const structuredContent = {
        campuses,
        etag: result.etag ?? null,
        requestId: result.requestId ?? null,
      };
      return {
        content: [{ text: JSON.stringify(structuredContent), type: "text" }],
        structuredContent,
      };
    } catch (error) {
      return mapToolError(error);
    } finally {
      request.cleanup();
    }
  }

  async listSources(
    input: {
      readonly campusId?: z.infer<typeof campusIdSchema>;
      readonly cursor?: string;
      readonly limit?: number;
    },
    signal: AbortSignal,
  ): Promise<CallToolResult> {
    const request = createRequestSignal(signal, this.#upstreamTimeoutMs);
    try {
      const result = await this.#client.request("listSources", {
        query: {
          ...(input.campusId === undefined ? {} : { campusId: input.campusId }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
        },
        signal: request.signal,
      });
      if (result.notModified) throw new Error("Unexpected not-modified response");
      const page = parseStrictUpstream(sourcePageSchema, result.data);
      const structuredContent = {
        etag: result.etag ?? null,
        nextCursor: page.nextCursor,
        requestId: result.requestId ?? null,
        sources: page.items,
      };
      return {
        content: [{ text: JSON.stringify(structuredContent), type: "text" }],
        structuredContent,
      };
    } catch (error) {
      return mapToolError(error);
    } finally {
      request.cleanup();
    }
  }

  async getWorldManifest(
    input: { readonly campusId: z.infer<typeof campusIdSchema> },
    signal: AbortSignal,
  ): Promise<CallToolResult> {
    const request = createRequestSignal(signal, this.#upstreamTimeoutMs);
    try {
      const result = await this.#client.request("getWorldManifest", {
        path: { campusId: input.campusId },
        signal: request.signal,
      });
      if (result.notModified) throw new Error("Unexpected not-modified response");
      const manifest = parseStrictUpstream(worldManifestSchema, result.data);
      const structuredContent = {
        etag: result.etag ?? null,
        manifest,
        requestId: result.requestId ?? null,
      };
      return {
        content: [{ text: JSON.stringify(structuredContent), type: "text" }],
        structuredContent,
      };
    } catch (error) {
      return mapToolError(error);
    } finally {
      request.cleanup();
    }
  }
}

export function createProtocolServer(toolService: McpToolService): McpServer {
  const server = new McpServer({ name: "umn-gopher-assistant", version: "0.1.0" });

  server.registerTool(
    "campuses_list",
    {
      annotations,
      description: MCP_TOOL_CATALOG[0].description,
      inputSchema: {},
      outputSchema: campusesOutputShape,
      title: MCP_TOOL_CATALOG[0].title,
    },
    async (_input, extra) => toolService.listCampuses(extra.signal),
  );

  server.registerTool(
    "sources_list",
    {
      annotations,
      description: MCP_TOOL_CATALOG[1].description,
      inputSchema: {
        campusId: campusIdSchema.optional().describe("Campus filter; omit to list all campuses."),
        cursor: z
          .string()
          .min(1)
          .max(2048)
          .optional()
          .describe("Opaque nextCursor from a previous sources_list response."),
        limit: z.number().int().min(1).max(100).default(25).describe("Maximum source records to return."),
      },
      outputSchema: sourcesOutputShape,
      title: MCP_TOOL_CATALOG[1].title,
    },
    async (input, extra) =>
      toolService.listSources(
        {
          ...(input.campusId === undefined ? {} : { campusId: input.campusId }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          limit: input.limit,
        },
        extra.signal,
      ),
  );

  server.registerTool(
    "world_manifest_get",
    {
      annotations,
      description: MCP_TOOL_CATALOG[2].description,
      inputSchema: {
        campusId: campusIdSchema.describe("Campus whose versioned world manifest should be returned."),
      },
      outputSchema: worldManifestOutputShape,
      title: MCP_TOOL_CATALOG[2].title,
    },
    async (input, extra) => toolService.getWorldManifest(input, extra.signal),
  );

  return server;
}
