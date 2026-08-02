// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createVaultCrypto } from "@umn-gopher-assistant/crypto";

import { PersonalVaultSyncHttpClient } from "../lib/personal-vault/sync-http-client";
import type { VaultHttpProtocolError } from "../lib/personal-vault/sync-http-client";
import {
  isDurableCommandRecoveryStatus,
  mayRenewRecoveryRotationProof,
} from "../lib/personal-vault/remote-recovery-retry";
import {
  isDurableOrdinarySyncRecoveryStatus,
  mayRenewOrdinarySyncProof,
} from "../lib/personal-vault/ordinary-sync-retry";
import { createDevicePairingRequest, hashPairingCode } from "../lib/personal-vault/sync-protocol";

const OWNER = "ERERERERERERERERERERERERERERERERERERERERERE";
const VAULT_ID = "10000000-0000-4000-8000-000000000001";
const ETAG = '"pv2:ERERERERERERERERERERERERERERERERERERERERERE"';
const RECOVERY = {
  formatVersion: 2,
  ownerBinding: OWNER,
  vaultId: VAULT_ID,
  keyId: "10000000-0000-4000-8000-000000000099",
  algorithm: "ED25519",
  publicKey: "ERERERERERERERERERERERERERERERERERERERERERE",
  fingerprint: "ERERERERERERERERERERERERERERERERERERERERERE",
  createdAt: "2026-07-23T00:00:00.000Z",
  revokedAt: null,
} as const;

function json(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(value, {
    ...init,
    headers,
  });
}

describe("personal-vault same-origin sync transport", () => {
  it("accepts the deliberately ETag-free bootstrap contract and never creates a bearer header", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(input).toBe("/api/personal/vault/bootstrap");
      const headers = new Headers(init?.headers);
      expect(headers.has("authorization")).toBe(false);
      expect(init?.credentials).toBe("same-origin");
      expect(init?.redirect).toBe("error");
      return json({
        formatVersion: 2,
        ownerBinding: OWNER,
        vault: {
          exists: true,
          vaultId: VAULT_ID,
          etag: ETAG,
          recoveryAuthorization: RECOVERY,
        },
      });
    });
    const client = new PersonalVaultSyncHttpClient(fetchMock);

    await expect(client.bootstrap()).resolves.toEqual({
      kind: "ok",
      value: {
        formatVersion: 2,
        ownerBinding: OWNER,
        vault: {
          exists: true,
          vaultId: VAULT_ID,
          etag: ETAG,
          recoveryAuthorization: RECOVERY,
        },
      },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("allows 304 only on conditional read/list operations and requires its strong ETag", async () => {
    const readClient = new PersonalVaultSyncHttpClient(
      vi.fn(async () => new Response(null, { status: 304, headers: { ETag: ETAG } })),
    );
    await expect(readClient.read("signed-read-proof", ETAG)).resolves.toEqual({
      kind: "not-modified",
      status: 304,
      etag: ETAG,
    });

    const bootstrapClient = new PersonalVaultSyncHttpClient(
      vi.fn(async () => new Response(null, { status: 304, headers: { ETag: ETAG } })),
    );
    await expect(bootstrapClient.bootstrap()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    } satisfies Partial<VaultHttpProtocolError>);
  });

  it("maps a signed-out problem without accepting token material from the page", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect([...headers.keys()]).not.toContain("authorization");
      expect([...headers.keys()]).not.toContain("cookie");
      return json(
        {
          type: "https://example.invalid/problems/authentication",
          title: "Authentication Required",
          status: 401,
          detail: "Sign in",
          failureCode: "AUTHENTICATION_REQUIRED",
          traceId: "trace",
        },
        { status: 401, headers: { "Content-Type": "application/problem+json" } },
      );
    });
    const client = new PersonalVaultSyncHttpClient(fetchMock);

    await expect(client.bootstrap()).resolves.toEqual({
      kind: "failure",
      status: 401,
      failureCode: "AUTHENTICATION_REQUIRED",
    });
  });

  it("preserves the API's 403 expired-proof status for fresh-read recovery and proof renewal", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      expect(input).toBe("/api/personal/vault");
      return json(
        {
          type: "https://example.invalid/problems/authorization",
          title: "Forbidden",
          status: 403,
          detail: "Command proof expired",
          failureCode: "EXPIRED_PROOF",
          traceId: "trace-expired",
        },
        {
          status: 403,
          headers: { "Content-Type": "application/problem+json" },
        },
      );
    });
    const client = new PersonalVaultSyncHttpClient(fetchMock);
    const result = await client.read("fresh-replacement-device-proof");

    expect(result).toEqual({
      kind: "failure",
      status: 403,
      failureCode: "EXPIRED_PROOF",
    });
    if (result.kind !== "failure") throw new Error("Expected a 403 fixture.");
    expect(isDurableCommandRecoveryStatus(result.status)).toBe(true);
    if (!isDurableCommandRecoveryStatus(result.status)) {
      throw new Error("Expired proof was not recoverable.");
    }
    expect(mayRenewRecoveryRotationProof(result.status)).toBe(true);
    expect(mayRenewRecoveryRotationProof(409)).toBe(false);
    expect(isDurableOrdinarySyncRecoveryStatus(result.status)).toBe(true);
    if (!isDurableOrdinarySyncRecoveryStatus(result.status)) {
      throw new Error("Expired ordinary sync proof was not recoverable.");
    }
    expect(mayRenewOrdinarySyncProof(result.status)).toBe(true);
    expect(mayRenewOrdinarySyncProof(409)).toBe(false);
  });

  it("replays the exact signed pairing request with the same idempotency key after a crash window", async () => {
    const crypto = await createVaultCrypto();
    const deviceKey = crypto.generateDeviceKey({
      deviceId: "20000000-0000-4000-8000-000000000002",
    });
    const authorizationKey = crypto.deriveDeviceAuthorizationKey({
      ownerBinding: OWNER,
      deviceKey,
      keyId: "30000000-0000-4000-8000-000000000003",
    });
    try {
      const request = createDevicePairingRequest({
        crypto,
        authorizationKey,
        ownerBinding: OWNER,
        vaultId: VAULT_ID,
        requestingDevice: crypto.createDeviceDescriptorV2({
          ownerBinding: OWNER,
          encryptionKey: deviceKey,
          authorizationKey,
        }),
        pairingCodeCommitment: await hashPairingCode("ABCD-2345"),
        clock: {
          now: () => new Date("2026-07-23T00:00:00.000Z"),
          randomUuid: () => "40000000-0000-4000-8000-000000000004",
        },
      });
      const bodies: string[] = [];
      const keys: string[] = [];
      const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
        if (typeof init?.body !== "string") throw new TypeError("Expected a JSON request body");
        bodies.push(init.body);
        keys.push(new Headers(init.headers).get("idempotency-key") ?? "");
        return json(
          {
            id: "50000000-0000-4000-8000-000000000005",
            vaultId: VAULT_ID,
            requestingDevice: request.requestingDevice,
            state: "pending",
            createdAt: request.issuedAt,
            updatedAt: request.issuedAt,
            expiresAt: request.expiresAt,
          },
          { status: 201, headers: { ETag: ETAG } },
        );
      });
      const client = new PersonalVaultSyncHttpClient(fetchMock);

      await client.createPairing(request, ETAG);
      await client.createPairing(request, ETAG);

      expect(bodies).toEqual([JSON.stringify(request), JSON.stringify(request)]);
      expect(keys).toEqual([request.operationId, request.operationId]);
    } finally {
      authorizationKey.destroy();
      deviceKey.destroy();
    }
  }, 30_000);

  it("replays bodyless pairing cancellation with one durable operation ID and no ambient token header", async () => {
    const crypto = await createVaultCrypto();
    const deviceKey = crypto.generateDeviceKey({
      deviceId: "20000000-0000-4000-8000-000000000002",
    });
    const authorizationKey = crypto.deriveDeviceAuthorizationKey({
      ownerBinding: OWNER,
      deviceKey,
      keyId: "30000000-0000-4000-8000-000000000003",
    });
    const pairingId = "50000000-0000-4000-8000-000000000005";
    const cancelOperationId = "60000000-0000-4000-8000-000000000006";
    try {
      const requestingDevice = crypto.createDeviceDescriptorV2({
        ownerBinding: OWNER,
        encryptionKey: deviceKey,
        authorizationKey,
      });
      const calls: RequestInit[] = [];
      const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
        expect(input).toBe(`/api/personal/vault/device-pairings/${pairingId}`);
        calls.push(init ?? {});
        return json(
          {
            id: pairingId,
            vaultId: VAULT_ID,
            requestingDevice,
            state: "cancelled",
            createdAt: requestingDevice.createdAt,
            updatedAt: requestingDevice.createdAt,
            expiresAt: new Date(Date.parse(requestingDevice.createdAt) + 15 * 60_000).toISOString(),
          },
          { status: 200, headers: { ETag: ETAG } },
        );
      });
      const client = new PersonalVaultSyncHttpClient(fetchMock);

      await client.cancelPairing(pairingId, ETAG, cancelOperationId);
      await client.cancelPairing(pairingId, ETAG, cancelOperationId);

      expect(calls).toHaveLength(2);
      for (const call of calls) {
        const headers = new Headers(call.headers);
        expect(call.method).toBe("DELETE");
        expect(call.body).toBeUndefined();
        expect(headers.get("if-match")).toBe(ETAG);
        expect(headers.get("idempotency-key")).toBe(cancelOperationId);
        expect(headers.has("authorization")).toBe(false);
        expect(headers.has("cookie")).toBe(false);
      }
    } finally {
      authorizationKey.destroy();
      deviceKey.destroy();
    }
  }, 30_000);

  it("rejects non-canonical cancellation identifiers before fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const client = new PersonalVaultSyncHttpClient(fetchMock);

    expect(() => client.cancelPairing("../approval", ETAG, "60000000-0000-4000-8000-000000000006")).toThrow(
      "Invalid pairing cancellation identifier",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
