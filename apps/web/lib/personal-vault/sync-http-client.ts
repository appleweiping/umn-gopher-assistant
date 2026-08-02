import {
  DevicePairingRequestV2Schema,
  DevicePairingViewV2Schema,
  PairingApprovalRequestV2Schema,
  RecoveryAuthorizationPublicKeyV2Schema,
  VaultCreateCommandV2Schema,
  VaultRotateKeyCommandV2Schema,
  VaultSyncSnapshotV2Schema,
  VaultUpdatePayloadCommandV2Schema,
  type DevicePairingRequestV2,
  type DevicePairingViewV2,
  type PairingApprovalRequestV2,
  type RecoveryAuthorizationPublicKeyV2,
  type VaultCreateCommandV2,
  type VaultRotateKeyCommandV2,
  type VaultSyncSnapshotV2,
  type VaultUpdatePayloadCommandV2,
} from "@umn-gopher-assistant/contracts";

const JSON_MEDIA_TYPE = /^application\/(?:problem\+)?json(?:\s*;\s*charset=utf-8)?$/iu;
const STRONG_ETAG = /^"[\x21\x23-\x7e]+"$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OWNER_BINDING = /^[A-Za-z0-9_-]{43}$/u;
const MAX_BODY_BYTES = 16 * 1_024 * 1_024;
type FailureStatus = 400 | 401 | 403 | 404 | 409 | 412 | 413 | 415 | 422 | 428 | 429 | 502 | 503;

export type VaultBootstrap =
  | {
      readonly formatVersion: 2;
      readonly ownerBinding: string;
      readonly vault: { readonly exists: false };
    }
  | {
      readonly formatVersion: 2;
      readonly ownerBinding: string;
      readonly vault: {
        readonly exists: true;
        readonly vaultId: string;
        readonly etag: string;
        readonly recoveryAuthorization: RecoveryAuthorizationPublicKeyV2;
      };
    };

export type VaultHttpResult<T> =
  | { readonly kind: "ok"; readonly status: 200 | 201; readonly etag: string; readonly value: T }
  | { readonly kind: "not-modified"; readonly status: 304; readonly etag: string }
  | {
      readonly kind: "failure";
      readonly status: 400 | 401 | 403 | 404 | 409 | 412 | 413 | 415 | 422 | 428 | 429 | 502 | 503;
      readonly failureCode: string | null;
    };

type RawVaultHttpResult<T> =
  | { readonly kind: "ok"; readonly status: 200 | 201; readonly etag: string | null; readonly value: T }
  | Exclude<VaultHttpResult<T>, { readonly kind: "ok" }>;

export class VaultHttpProtocolError extends Error {
  constructor(readonly code: "INVALID_RESPONSE" | "NETWORK_UNAVAILABLE") {
    super(code === "NETWORK_UNAVAILABLE" ? "Vault sync network unavailable" : "Invalid vault sync response");
    this.name = "VaultHttpProtocolError";
  }
}

type Fetch = typeof fetch;

interface RequestOptions {
  readonly method: "DELETE" | "GET" | "POST" | "PUT";
  readonly body?: unknown;
  readonly etag?: string;
  readonly idempotencyKey?: string;
  readonly ifNoneMatch?: string;
  readonly readProof?: string;
  readonly allowNotModified?: boolean;
  readonly allowMissingSuccessEtag?: boolean;
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
    ? record
    : null;
}

function parseBootstrap(value: unknown): VaultBootstrap {
  const record = exactRecord(value, ["formatVersion", "ownerBinding", "vault"]);
  if (
    record?.["formatVersion"] !== 2 ||
    typeof record["ownerBinding"] !== "string" ||
    !OWNER_BINDING.test(record["ownerBinding"])
  ) {
    throw new VaultHttpProtocolError("INVALID_RESPONSE");
  }
  const absent = exactRecord(record["vault"], ["exists"]);
  if (absent?.["exists"] === false) {
    return { formatVersion: 2, ownerBinding: record["ownerBinding"], vault: { exists: false } };
  }
  const present = exactRecord(record["vault"], ["etag", "exists", "recoveryAuthorization", "vaultId"]);
  if (
    present?.["exists"] !== true ||
    typeof present["vaultId"] !== "string" ||
    !UUID.test(present["vaultId"]) ||
    typeof present["etag"] !== "string" ||
    !STRONG_ETAG.test(present["etag"])
  ) {
    throw new VaultHttpProtocolError("INVALID_RESPONSE");
  }
  return {
    formatVersion: 2,
    ownerBinding: record["ownerBinding"],
    vault: {
      exists: true,
      vaultId: present["vaultId"],
      etag: present["etag"],
      recoveryAuthorization: RecoveryAuthorizationPublicKeyV2Schema.parse(present["recoveryAuthorization"]),
    },
  };
}

function safeEtag(response: Response): string {
  const etag = response.headers.get("etag");
  if (etag === null || !STRONG_ETAG.test(etag) || etag.includes(",")) {
    throw new VaultHttpProtocolError("INVALID_RESPONSE");
  }
  return etag;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!JSON_MEDIA_TYPE.test(response.headers.get("content-type") ?? "")) {
    await response.body?.cancel().catch(() => undefined);
    throw new VaultHttpProtocolError("INVALID_RESPONSE");
  }
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    await response.body?.cancel().catch(() => undefined);
    throw new VaultHttpProtocolError("INVALID_RESPONSE");
  }
  if (response.body === null) throw new VaultHttpProtocolError("INVALID_RESPONSE");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel("Vault response exceeded client limit");
        throw new VaultHttpProtocolError("INVALID_RESPONSE");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  try {
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    if (error instanceof VaultHttpProtocolError) throw error;
    throw new VaultHttpProtocolError("INVALID_RESPONSE");
  } finally {
    bytes.fill(0);
  }
}

function failureCode(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)["failureCode"];
  return typeof candidate === "string" && /^[A-Z][A-Z0-9_]{1,127}$/u.test(candidate) ? candidate : null;
}

function assertPath(path: string): void {
  if (
    path !== "/api/personal/vault/bootstrap" &&
    path !== "/api/personal/vault" &&
    path !== "/api/personal/vault/payload" &&
    path !== "/api/personal/vault/rotations" &&
    path !== "/api/personal/vault/device-pairings" &&
    !/^\/api\/personal\/vault\/device-pairings\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      path,
    ) &&
    !/^\/api\/personal\/vault\/device-pairings\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/approval$/u.test(
      path,
    )
  ) {
    throw new TypeError("Vault sync client path is not allowlisted");
  }
}

async function request(
  fetchImpl: Fetch,
  path: string,
  options: RequestOptions,
): Promise<RawVaultHttpResult<unknown>> {
  assertPath(path);
  const headers = new Headers({ Accept: "application/json, application/problem+json" });
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.etag !== undefined) headers.set("If-Match", options.etag);
  if (options.ifNoneMatch !== undefined) headers.set("If-None-Match", options.ifNoneMatch);
  if (options.idempotencyKey !== undefined) headers.set("Idempotency-Key", options.idempotencyKey);
  if (options.readProof !== undefined) headers.set("X-Vault-Read-Proof", options.readProof);
  let response: Response;
  try {
    response = await fetchImpl(path, {
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      cache: "no-store",
      credentials: "same-origin",
      headers,
      method: options.method,
      redirect: "error",
    });
  } catch {
    throw new VaultHttpProtocolError("NETWORK_UNAVAILABLE");
  }
  if (response.redirected || (response.url !== "" && new URL(response.url).origin !== self.location.origin)) {
    await response.body?.cancel().catch(() => undefined);
    throw new VaultHttpProtocolError("INVALID_RESPONSE");
  }
  if (response.status === 304) {
    if (options.allowNotModified !== true) {
      await response.body?.cancel().catch(() => undefined);
      throw new VaultHttpProtocolError("INVALID_RESPONSE");
    }
    await response.body?.cancel().catch(() => undefined);
    return { kind: "not-modified", status: 304, etag: safeEtag(response) };
  }
  const value = await boundedJson(response);
  if (response.status === 200 || response.status === 201) {
    return {
      kind: "ok",
      status: response.status,
      etag: options.allowMissingSuccessEtag === true ? optionalEtag(response) : safeEtag(response),
      value,
    };
  }
  if ([400, 401, 403, 404, 409, 412, 413, 415, 422, 428, 429, 502, 503].includes(response.status)) {
    return {
      kind: "failure",
      status: response.status as FailureStatus,
      failureCode: failureCode(value),
    };
  }
  throw new VaultHttpProtocolError("INVALID_RESPONSE");
}

function requireOk<T>(
  result: RawVaultHttpResult<unknown>,
  parser: (value: unknown) => T,
): VaultHttpResult<T> {
  if (result.kind !== "ok") return result;
  if (result.etag === null) throw new VaultHttpProtocolError("INVALID_RESPONSE");
  try {
    return { kind: "ok", status: result.status, etag: result.etag, value: parser(result.value) };
  } catch {
    throw new VaultHttpProtocolError("INVALID_RESPONSE");
  }
}

function requireSnapshot(result: RawVaultHttpResult<unknown>): VaultHttpResult<VaultSyncSnapshotV2> {
  const parsed = requireOk(result, (value) => VaultSyncSnapshotV2Schema.parse(value));
  if (parsed.kind === "ok" && parsed.etag !== `"pv2:${parsed.value.commitHash}"`) {
    throw new VaultHttpProtocolError("INVALID_RESPONSE");
  }
  return parsed;
}

function optionalEtag(response: Response): string | null {
  return response.headers.has("etag") ? safeEtag(response) : null;
}

export class PersonalVaultSyncHttpClient {
  constructor(private readonly fetchImpl: Fetch = fetch) {}

  async bootstrap(): Promise<
    | { readonly kind: "ok"; readonly value: VaultBootstrap }
    | Extract<VaultHttpResult<never>, { readonly kind: "failure" }>
  > {
    const result = await request(this.fetchImpl, "/api/personal/vault/bootstrap", {
      method: "GET",
      allowMissingSuccessEtag: true,
    });
    if (result.kind === "not-modified") throw new VaultHttpProtocolError("INVALID_RESPONSE");
    if (result.kind === "failure") return result;
    return { kind: "ok", value: parseBootstrap(result.value) };
  }

  read(readProof: string, etag?: string): Promise<VaultHttpResult<VaultSyncSnapshotV2>> {
    return request(this.fetchImpl, "/api/personal/vault", {
      method: "GET",
      allowNotModified: true,
      readProof,
      ...(etag === undefined ? {} : { ifNoneMatch: etag }),
    }).then(requireSnapshot);
  }

  create(command: VaultCreateCommandV2): Promise<VaultHttpResult<VaultSyncSnapshotV2>> {
    const checked = VaultCreateCommandV2Schema.parse(command);
    return request(this.fetchImpl, "/api/personal/vault", {
      method: "POST",
      body: checked,
      ifNoneMatch: "*",
      idempotencyKey: checked.operationId,
    }).then(requireSnapshot);
  }

  update(command: VaultUpdatePayloadCommandV2, etag: string): Promise<VaultHttpResult<VaultSyncSnapshotV2>> {
    const checked = VaultUpdatePayloadCommandV2Schema.parse(command);
    return request(this.fetchImpl, "/api/personal/vault/payload", {
      method: "PUT",
      body: checked,
      etag,
      idempotencyKey: checked.operationId,
    }).then(requireSnapshot);
  }

  rotate(command: VaultRotateKeyCommandV2, etag: string): Promise<VaultHttpResult<VaultSyncSnapshotV2>> {
    const checked = VaultRotateKeyCommandV2Schema.parse(command);
    return request(this.fetchImpl, "/api/personal/vault/rotations", {
      method: "POST",
      body: checked,
      etag,
      idempotencyKey: checked.operationId,
    }).then(requireSnapshot);
  }

  listPairings(etag?: string): Promise<VaultHttpResult<readonly DevicePairingViewV2[]>> {
    return request(this.fetchImpl, "/api/personal/vault/device-pairings", {
      method: "GET",
      allowNotModified: true,
      ...(etag === undefined ? {} : { ifNoneMatch: etag }),
    }).then((result) =>
      requireOk(result, (value) => {
        const record = exactRecord(value, ["items"]);
        if (record === null || !Array.isArray(record["items"])) throw new TypeError("Invalid pairing list");
        return Object.freeze(record["items"].map((item) => DevicePairingViewV2Schema.parse(item)));
      }),
    );
  }

  createPairing(
    pairing: DevicePairingRequestV2,
    etag: string,
  ): Promise<VaultHttpResult<DevicePairingViewV2>> {
    const checked = DevicePairingRequestV2Schema.parse(pairing);
    return request(this.fetchImpl, "/api/personal/vault/device-pairings", {
      method: "POST",
      body: checked,
      etag,
      idempotencyKey: checked.operationId,
    }).then((result) => requireOk(result, (value) => DevicePairingViewV2Schema.parse(value)));
  }

  cancelPairing(
    pairingId: string,
    etag: string,
    idempotencyKey: string,
  ): Promise<VaultHttpResult<DevicePairingViewV2>> {
    if (!UUID.test(pairingId) || !UUID.test(idempotencyKey)) {
      throw new TypeError("Invalid pairing cancellation identifier");
    }
    return request(this.fetchImpl, `/api/personal/vault/device-pairings/${pairingId}`, {
      method: "DELETE",
      etag,
      idempotencyKey,
    }).then((result) => requireOk(result, (value) => DevicePairingViewV2Schema.parse(value)));
  }

  approvePairing(
    pairingId: string,
    approval: PairingApprovalRequestV2,
    etag: string,
  ): Promise<VaultHttpResult<VaultSyncSnapshotV2>> {
    if (!UUID.test(pairingId)) throw new TypeError("Invalid pairing identifier");
    const checked = PairingApprovalRequestV2Schema.parse(approval);
    return request(this.fetchImpl, `/api/personal/vault/device-pairings/${pairingId}/approval`, {
      method: "POST",
      body: checked,
      etag,
      idempotencyKey: checked.command.operationId,
    }).then(requireSnapshot);
  }
}
