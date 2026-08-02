import { randomBytes, randomUUID } from "node:crypto";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import {
  AuthorizationManifestV2Schema,
  VaultCreateCommandV2Schema,
  VaultRotateKeyCommandV2Schema,
  VaultSyncSnapshotV2Schema,
  VaultUpdatePayloadCommandV2Schema,
  encodeVaultReadProofHeaderV2,
  type VaultSyncSnapshotV2,
} from "@umn-gopher-assistant/contracts";
import {
  createVaultCrypto,
  type AuthorizationKeyHandle,
  type DeviceKeyHandle,
  type VaultCrypto,
  type VaultKeyHandle,
} from "@umn-gopher-assistant/crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccountIdentityUnavailableError, type AccountResolver } from "../src/accounts/account.types.js";
import { AppModule } from "../src/app.module.js";
import { ACCESS_TOKEN_VERIFIER, DPOP_PROOF_VERIFIER } from "../src/auth/auth.tokens.js";
import type {
  AccessTokenVerifier,
  AuthPrincipal,
  DpopProofVerifier,
  VerifiedAccessToken,
} from "../src/auth/auth.types.js";
import { createFastifyAdapter } from "../src/http/fastify-adapter.js";
import type { ProblemDetails } from "../src/http/problem-details.filter.js";
import type { PersonalVaultRepository } from "../src/personal-vault/personal-vault.repository.js";
import { PersonalVaultService } from "../src/personal-vault/personal-vault.service.js";
import type { ReadProofReplayGuard } from "../src/personal-vault/read-proof-replay.guard.js";

const RECOVERY_CODE = "UGA1-000G-40R4-0M30-E209-185G-R38E-1W81-24GK";
const NEXT_RECOVERY_CODE = "UGA1-1111-1111-1111-1111-1111-1111-1111-1111";

interface GenesisFixture {
  readonly authorization: AuthorizationKeyHandle;
  readonly command: ReturnType<typeof VaultCreateCommandV2Schema.parse>;
  readonly device: DeviceKeyHandle;
  readonly snapshot: VaultSyncSnapshotV2;
  readonly vault: VaultKeyHandle;
}

function expiresFrom(issuedAt: string, minutes: number): string {
  return new Date(Date.parse(issuedAt) + minutes * 60_000).toISOString();
}

async function createGenesis(crypto: VaultCrypto, ownerBinding: string): Promise<GenesisFixture> {
  const vaultId = randomUUID();
  const vault = crypto.generateVaultKey({ vaultId });
  const device = crypto.generateDeviceKey({
    deviceId: randomUUID(),
    deviceKeyId: randomUUID(),
  });
  const authorization = crypto.generateAuthorizationKey({
    ownerBinding,
    deviceId: device.publicKey.deviceId,
    keyId: randomUUID(),
  });
  const descriptor = crypto.createDeviceDescriptorV2({
    ownerBinding,
    encryptionKey: device,
    authorizationKey: authorization,
  });
  const recovery = crypto.deriveRecoveryAuthorizationKey({
    recoveryCode: RECOVERY_CODE,
    ownerBinding,
    vaultId,
    keyId: randomUUID(),
  });
  const recoveryPublic = crypto.createRecoveryAuthorizationPublicKeyV2({
    authorizationKey: recovery,
  });
  const payload = crypto.encryptPayloadV2({
    key: vault,
    ownerBinding,
    plaintext: new TextEncoder().encode('{"tasks":[]}'),
    revision: 1,
    baseRevision: null,
  });
  const keyring = crypto.createKeyring({
    key: vault,
    recoveryCode: RECOVERY_CODE,
    recipients: [device.publicKey],
    revision: 1,
  }).keyring;
  const updatedAt = new Date().toISOString();
  const manifest = AuthorizationManifestV2Schema.parse({
    formatVersion: 2,
    ownerBinding,
    vaultId,
    epoch: 1,
    revision: 1,
    devices: [descriptor],
    recoveryAuthorization: recoveryPublic,
    createdAt: descriptor.createdAt,
    updatedAt,
  });
  const operationId = randomUUID();
  const commit = crypto.signVaultCommit({
    authorizationKey: authorization,
    vaultKey: vault,
    commit: {
      formatVersion: 2,
      ownerBinding,
      vaultId,
      epoch: 1,
      sequence: 1,
      parentCommitHash: null,
      payloadHash: crypto.hashVaultPayloadV2(payload),
      keyringHash: crypto.hashVaultKeyringV1(keyring),
      authorizationManifestHash: crypto.hashAuthorizationManifestV2(manifest),
      operationId,
      author: {
        kind: "DEVICE",
        keyId: authorization.keyId,
        deviceId: device.publicKey.deviceId,
      },
      createdAt: new Date().toISOString(),
    },
  });
  const snapshot = VaultSyncSnapshotV2Schema.parse({
    formatVersion: 2,
    ownerBinding,
    vaultId,
    commitHash: crypto.computeVaultCommitHash(commit),
    commit,
    payload,
    keyring,
    authorizationManifest: manifest,
  });
  const issuedAt = new Date().toISOString();
  const proof = crypto.signVaultCommandProof({
    authorizationKey: authorization,
    proof: {
      formatVersion: 2,
      commandType: "CREATE_VAULT",
      ownerBinding,
      vaultId,
      operationId,
      expectedParentCommitHash: null,
      nextCommitHash: snapshot.commitHash,
      signer: commit.author,
      issuedAt,
      expiresAt: expiresFrom(issuedAt, 5),
    },
  });
  recovery.destroy();
  return {
    authorization,
    command: VaultCreateCommandV2Schema.parse({
      formatVersion: 2,
      commandType: "CREATE_VAULT",
      ownerBinding,
      vaultId,
      operationId,
      proof,
      snapshot,
    }),
    device,
    snapshot,
    vault,
  };
}

function destroyFixture(fixture: GenesisFixture): void {
  fixture.authorization.destroy();
  fixture.device.destroy();
  fixture.vault.destroy();
}

async function staleUpdate(
  crypto: VaultCrypto,
  fixture: GenesisFixture,
): Promise<ReturnType<typeof VaultUpdatePayloadCommandV2Schema.parse>> {
  const current = fixture.snapshot;
  const payload = crypto.encryptPayloadV2({
    key: fixture.vault,
    ownerBinding: current.ownerBinding,
    plaintext: new TextEncoder().encode('{"tasks":[{"id":"one"}]}'),
    revision: 2,
    baseRevision: 1,
  });
  const operationId = randomUUID();
  const commit = crypto.signVaultCommit({
    authorizationKey: fixture.authorization,
    vaultKey: fixture.vault,
    commit: {
      formatVersion: 2,
      ownerBinding: current.ownerBinding,
      vaultId: current.vaultId,
      epoch: 1,
      sequence: 2,
      parentCommitHash: current.commitHash,
      payloadHash: crypto.hashVaultPayloadV2(payload),
      keyringHash: current.commit.keyringHash,
      authorizationManifestHash: current.commit.authorizationManifestHash,
      operationId,
      author: current.commit.author,
      createdAt: new Date().toISOString(),
    },
  });
  const nextSnapshot = VaultSyncSnapshotV2Schema.parse({
    ...current,
    commitHash: crypto.computeVaultCommitHash(commit),
    commit,
    payload,
  });
  const issuedAt = new Date().toISOString();
  const proof = crypto.signVaultCommandProof({
    authorizationKey: fixture.authorization,
    proof: {
      formatVersion: 2,
      commandType: "UPDATE_PAYLOAD",
      ownerBinding: current.ownerBinding,
      vaultId: current.vaultId,
      operationId,
      expectedParentCommitHash: current.commitHash,
      nextCommitHash: nextSnapshot.commitHash,
      signer: commit.author,
      issuedAt,
      expiresAt: expiresFrom(issuedAt, 5),
    },
  });
  return VaultUpdatePayloadCommandV2Schema.parse({
    formatVersion: 2,
    commandType: "UPDATE_PAYLOAD",
    ownerBinding: current.ownerBinding,
    vaultId: current.vaultId,
    operationId,
    expectedParentCommitHash: current.commitHash,
    nextSnapshot,
    proof,
  });
}

async function recoveryRotation(
  crypto: VaultCrypto,
  fixture: GenesisFixture,
  reuseRecoveryAuthorizationMaterial: boolean,
): Promise<{
  readonly command: ReturnType<typeof VaultRotateKeyCommandV2Schema.parse>;
  readonly nextVault: VaultKeyHandle;
}> {
  const current = fixture.snapshot;
  const nextVault = crypto.generateVaultKey({ vaultId: current.vaultId });
  const nextRecovery = crypto.deriveRecoveryAuthorizationKey({
    recoveryCode: NEXT_RECOVERY_CODE,
    ownerBinding: current.ownerBinding,
    vaultId: current.vaultId,
    keyId: randomUUID(),
  });
  try {
    const generatedRecoveryPublic = crypto.createRecoveryAuthorizationPublicKeyV2({
      authorizationKey: nextRecovery,
    });
    const recoveryAuthorization = reuseRecoveryAuthorizationMaterial
      ? {
          ...current.authorizationManifest.recoveryAuthorization,
          keyId: generatedRecoveryPublic.keyId,
          createdAt: generatedRecoveryPublic.createdAt,
        }
      : generatedRecoveryPublic;
    const payload = crypto.encryptPayloadV2({
      key: nextVault,
      ownerBinding: current.ownerBinding,
      plaintext: new TextEncoder().encode('{"tasks":[]}'),
      revision: current.payload.revision + 1,
      baseRevision: current.payload.revision,
    });
    const keyring = crypto.createKeyring({
      key: nextVault,
      recoveryCode: NEXT_RECOVERY_CODE,
      recipients: [fixture.device.publicKey],
      revision: current.keyring.revision + 1,
    }).keyring;
    const transitionAt = new Date(
      Math.max(
        Date.parse(payload.createdAt),
        Date.parse(keyring.updatedAt),
        Date.parse(recoveryAuthorization.createdAt),
        Date.parse(current.authorizationManifest.updatedAt),
      ),
    ).toISOString();
    const manifest = AuthorizationManifestV2Schema.parse({
      ...current.authorizationManifest,
      epoch: current.authorizationManifest.epoch + 1,
      revision: current.authorizationManifest.revision + 1,
      recoveryAuthorization,
      updatedAt: transitionAt,
    });
    const operationId = randomUUID();
    const author = {
      kind: "DEVICE" as const,
      keyId: fixture.authorization.keyId,
      deviceId: fixture.device.publicKey.deviceId,
    };
    const commit = crypto.signVaultCommit({
      authorizationKey: fixture.authorization,
      vaultKey: nextVault,
      commit: {
        formatVersion: 2,
        ownerBinding: current.ownerBinding,
        vaultId: current.vaultId,
        epoch: current.commit.epoch + 1,
        sequence: current.commit.sequence + 1,
        parentCommitHash: current.commitHash,
        payloadHash: crypto.hashVaultPayloadV2(payload),
        keyringHash: crypto.hashVaultKeyringV1(keyring),
        authorizationManifestHash: crypto.hashAuthorizationManifestV2(manifest),
        operationId,
        author,
        createdAt: transitionAt,
      },
    });
    const nextSnapshot = VaultSyncSnapshotV2Schema.parse({
      ...current,
      commitHash: crypto.computeVaultCommitHash(commit),
      commit,
      payload,
      keyring,
      authorizationManifest: manifest,
    });
    const issuedAt = new Date(Math.max(Date.now(), Date.parse(transitionAt))).toISOString();
    const proof = crypto.signVaultCommandProof({
      authorizationKey: fixture.authorization,
      proof: {
        formatVersion: 2,
        commandType: "ROTATE_KEY",
        ownerBinding: current.ownerBinding,
        vaultId: current.vaultId,
        operationId,
        expectedParentCommitHash: current.commitHash,
        nextCommitHash: nextSnapshot.commitHash,
        signer: author,
        issuedAt,
        expiresAt: expiresFrom(issuedAt, 5),
      },
    });
    return {
      command: VaultRotateKeyCommandV2Schema.parse({
        formatVersion: 2,
        commandType: "ROTATE_KEY",
        ownerBinding: current.ownerBinding,
        vaultId: current.vaultId,
        operationId,
        expectedParentCommitHash: current.commitHash,
        reason: "RECOVERY_ROTATED",
        nextSnapshot,
        proof,
      }),
      nextVault,
    };
  } catch (error) {
    nextVault.destroy();
    throw error;
  } finally {
    nextRecovery.destroy();
  }
}

const TEST_DPOP_JKT = Buffer.alloc(32, 11).toString("base64url");
const principals: Readonly<Record<string, VerifiedAccessToken>> = {
  "token-a": {
    clientId: "gopher-web",
    dpopJkt: TEST_DPOP_JKT,
    issuer: "https://identity.example.edu/realms/gopher",
    scopes: ["personal:read", "personal:write"],
    subject: "student-a",
  },
  "token-a-read-only": {
    clientId: "gopher-web",
    dpopJkt: TEST_DPOP_JKT,
    issuer: "https://identity.example.edu/realms/gopher",
    scopes: ["personal:read"],
    subject: "student-a",
  },
  "token-b": {
    clientId: "gopher-web",
    dpopJkt: TEST_DPOP_JKT,
    issuer: "https://identity.example.edu/realms/gopher",
    scopes: ["personal:read", "personal:write"],
    subject: "student-b",
  },
  "token-read-only": {
    clientId: "gopher-web",
    dpopJkt: TEST_DPOP_JKT,
    issuer: "https://identity.example.edu/realms/gopher",
    scopes: ["personal:read"],
    subject: "student-read-only",
  },
  "token-write-only": {
    clientId: "gopher-web",
    dpopJkt: TEST_DPOP_JKT,
    issuer: "https://identity.example.edu/realms/gopher",
    scopes: ["personal:write"],
    subject: "student-write-only",
  },
};
const principalA = principals["token-a"] as AuthPrincipal;

let app: NestFastifyApplication;

beforeAll(async () => {
  const proofVerifier: DpopProofVerifier = { verify: () => Promise.resolve() };
  const verifier: AccessTokenVerifier = {
    verify(token) {
      const resolved = principals[token];
      return resolved === undefined ? Promise.reject(new Error("invalid token")) : Promise.resolve(resolved);
    },
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ACCESS_TOKEN_VERIFIER)
    .useValue(verifier)
    .overrideProvider(DPOP_PROOF_VERIFIER)
    .useValue(proofVerifier)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter({ NODE_ENV: "test" }), {
    logger: false,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

function authorization(token: keyof typeof principals): {
  readonly authorization: string;
  readonly dpop: string;
} {
  return { authorization: `DPoP ${token}`, dpop: "test-harness-proof" };
}

describe("personal vault HTTP boundary", () => {
  it("requires the minimal personal:read scope for bootstrap", async () => {
    const readOnly = await app.inject({
      method: "GET",
      url: "/v1/personal/vault/bootstrap",
      headers: authorization("token-read-only"),
    });
    expect(readOnly.statusCode).toBe(200);
    expect(readOnly.json()).toMatchObject({
      formatVersion: 2,
      vault: { exists: false },
    });

    const writeOnly = await app.inject({
      method: "GET",
      url: "/v1/personal/vault/bootstrap",
      headers: authorization("token-write-only"),
    });
    expect(writeOnly.statusCode).toBe(403);
  });

  it("bootstraps, creates, enforces signed reads, hides cross-account state, and returns 412 preconditions", async () => {
    const bootstrap = await app.inject({
      method: "GET",
      url: "/v1/personal/vault/bootstrap",
      headers: authorization("token-a"),
    });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.headers["cache-control"]).toBe("no-store");
    const initial = bootstrap.json<{
      readonly ownerBinding: string;
      readonly vault: { readonly exists: boolean };
    }>();
    expect(initial.vault).toEqual({ exists: false });
    expect(initial.ownerBinding).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(initial.vault).not.toHaveProperty("recoveryAuthorization");

    const crypto = await createVaultCrypto();
    const fixture = await createGenesis(crypto, initial.ownerBinding);
    const create = await app.inject({
      method: "POST",
      url: "/v1/personal/vault",
      headers: {
        ...authorization("token-a"),
        "content-type": "application/json",
        "if-none-match": "*",
        "idempotency-key": fixture.command.operationId,
      },
      payload: fixture.command,
    });
    expect(create.statusCode).toBe(201);
    const etag = create.headers.etag;
    expect(etag).toBe(`"pv2:${fixture.snapshot.commitHash}"`);

    const afterCreate = await app.inject({
      method: "GET",
      url: "/v1/personal/vault/bootstrap",
      headers: authorization("token-a"),
    });
    expect(afterCreate.json()).toMatchObject({
      formatVersion: 2,
      ownerBinding: initial.ownerBinding,
      vault: {
        exists: true,
        vaultId: fixture.snapshot.vaultId,
        etag,
        recoveryAuthorization: fixture.snapshot.authorizationManifest.recoveryAuthorization,
      },
    });
    const bootstrapBody = afterCreate.json<Record<string, unknown>>();
    const serializedBootstrap = JSON.stringify(bootstrapBody);
    expect(serializedBootstrap).not.toContain('"payload"');
    expect(serializedBootstrap).not.toContain('"keyring"');
    expect(serializedBootstrap).not.toContain('"devices"');
    expect(serializedBootstrap).not.toContain('"ciphertext"');

    const readOnlyBootstrap = await app.inject({
      method: "GET",
      url: "/v1/personal/vault/bootstrap",
      headers: authorization("token-a-read-only"),
    });
    expect(readOnlyBootstrap.statusCode).toBe(200);
    expect(readOnlyBootstrap.headers["cache-control"]).toBe("no-store");
    expect(readOnlyBootstrap.json()).toMatchObject({
      vault: {
        exists: true,
        recoveryAuthorization: fixture.snapshot.authorizationManifest.recoveryAuthorization,
      },
    });

    const otherAccountBootstrap = await app.inject({
      method: "GET",
      url: "/v1/personal/vault/bootstrap",
      headers: authorization("token-b"),
    });
    expect(otherAccountBootstrap.statusCode).toBe(200);
    expect(otherAccountBootstrap.json()).toMatchObject({
      vault: { exists: false },
    });
    expect(JSON.stringify(otherAccountBootstrap.json())).not.toContain(
      fixture.snapshot.authorizationManifest.recoveryAuthorization.keyId,
    );

    const issuedAt = new Date().toISOString();
    const readProof = crypto.signVaultReadProof({
      authorizationKey: fixture.authorization,
      proof: {
        formatVersion: 2,
        ownerBinding: initial.ownerBinding,
        vaultId: fixture.snapshot.vaultId,
        signer: fixture.snapshot.commit.author,
        nonce: randomBytes(32).toString("base64url"),
        issuedAt,
        expiresAt: expiresFrom(issuedAt, 2),
      },
    });
    const encodedReadProof = encodeVaultReadProofHeaderV2(readProof);
    const read = await app.inject({
      method: "GET",
      url: "/v1/personal/vault",
      headers: {
        ...authorization("token-a"),
        "x-vault-read-proof": encodedReadProof,
      },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(fixture.snapshot);
    const replay = await app.inject({
      method: "GET",
      url: "/v1/personal/vault",
      headers: {
        ...authorization("token-a"),
        "x-vault-read-proof": encodedReadProof,
      },
    });
    expect(replay.statusCode).toBe(403);

    const crossAccount = await app.inject({
      method: "POST",
      url: "/v1/personal/vault",
      headers: {
        ...authorization("token-b"),
        "content-type": "application/json",
        "if-none-match": "*",
        "idempotency-key": fixture.command.operationId,
      },
      payload: fixture.command,
    });
    expect(crossAccount.statusCode).toBe(404);

    const stale = await staleUpdate(crypto, fixture);
    const tamperedCommit = {
      ...fixture.snapshot.commit,
      signature: Buffer.alloc(64, 11).toString("base64url"),
    };
    const tamperedSnapshot = VaultSyncSnapshotV2Schema.parse({
      ...fixture.snapshot,
      commit: tamperedCommit,
      commitHash: crypto.computeVaultCommitHash(tamperedCommit),
    });
    const tamperedRepository = {
      findDurableReplay: () => Promise.resolve(null),
      getSnapshot: () =>
        Promise.resolve({
          etag: `"pv2:${tamperedSnapshot.commitHash}"`,
          revision: 1,
          snapshot: tamperedSnapshot,
        }),
    } as unknown as PersonalVaultRepository;
    const stableAccount: AccountResolver = {
      resolve: () =>
        Promise.resolve({
          accountId: "018fb9d8-3ec5-7e8b-a512-35f8ff523100",
          ownerBinding: initial.ownerBinding,
        }),
    };
    const tamperedService = new PersonalVaultService(
      stableAccount,
      tamperedRepository,
      {} as ReadProofReplayGuard,
    );
    await expect(tamperedService.bootstrap(principalA)).rejects.toMatchObject({ status: 503 });
    await expect(tamperedService.read(principalA, "invalid")).rejects.toMatchObject({ status: 503 });
    await expect(
      tamperedService.updatePayload(principalA, stale, etag, stale.operationId),
    ).rejects.toMatchObject({ status: 503 });

    const staleResponse = await app.inject({
      method: "PUT",
      url: "/v1/personal/vault/payload",
      headers: {
        ...authorization("token-a"),
        "content-type": "application/json",
        "if-match": '"pv2:stale"',
        "idempotency-key": stale.operationId,
      },
      payload: stale,
    });
    expect(staleResponse.statusCode).toBe(412);
    expect(staleResponse.json<ProblemDetails>().failureCode).toBe("VAULT_STALE_WRITE");

    const other = await createGenesis(crypto, initial.ownerBinding);
    const alreadyExists = await app.inject({
      method: "POST",
      url: "/v1/personal/vault",
      headers: {
        ...authorization("token-a"),
        "content-type": "application/json",
        "if-none-match": "*",
        "idempotency-key": other.command.operationId,
      },
      payload: other.command,
    });
    expect(alreadyExists.statusCode).toBe(412);
    expect(alreadyExists.json<ProblemDetails>().failureCode).toBe("VAULT_ALREADY_EXISTS");

    const keyIdOnlyRecovery = await recoveryRotation(crypto, fixture, true);
    try {
      const rejectedRecovery = await app.inject({
        method: "POST",
        url: "/v1/personal/vault/rotations",
        headers: {
          ...authorization("token-a"),
          "content-type": "application/json",
          "if-match": etag,
          "idempotency-key": keyIdOnlyRecovery.command.operationId,
        },
        payload: keyIdOnlyRecovery.command,
      });
      expect(rejectedRecovery.statusCode).toBe(409);
      expect(rejectedRecovery.json<ProblemDetails>().detail).toContain(
        "genuinely new recovery authorization key",
      );
    } finally {
      keyIdOnlyRecovery.nextVault.destroy();
    }

    const hardenedRecovery = await recoveryRotation(crypto, fixture, false);
    try {
      const acceptedRecovery = await app.inject({
        method: "POST",
        url: "/v1/personal/vault/rotations",
        headers: {
          ...authorization("token-a"),
          "content-type": "application/json",
          "if-match": etag,
          "idempotency-key": hardenedRecovery.command.operationId,
        },
        payload: hardenedRecovery.command,
      });
      expect(acceptedRecovery.statusCode).toBe(200);
      expect(acceptedRecovery.json()).toMatchObject({
        commitHash: hardenedRecovery.command.nextSnapshot.commitHash,
        authorizationManifest: {
          revision: 2,
        },
      });
    } finally {
      hardenedRecovery.nextVault.destroy();
    }

    destroyFixture(other);
    destroyFixture(fixture);
  }, 60_000);

  it("maps account resolver outages to 503 instead of hiding them as 404", async () => {
    const unavailableAccounts: AccountResolver = {
      resolve: () => Promise.reject(new AccountIdentityUnavailableError()),
    };
    const service = new PersonalVaultService(
      unavailableAccounts,
      {} as PersonalVaultRepository,
      {} as ReadProofReplayGuard,
    );
    await expect(service.bootstrap(principalA)).rejects.toMatchObject({
      status: 503,
    });
  });

  it("serves successful pairing approvals and rotations as HTTP 200", async () => {
    const verifier: AccessTokenVerifier = {
      verify: () =>
        Promise.resolve({
          ...principalA,
          dpopJkt: TEST_DPOP_JKT,
        }),
    };
    const result = {
      etag: `"pv2:${Buffer.alloc(32, 30).toString("base64url")}"`,
      replayed: false,
      revision: 2,
      snapshot: { ok: true },
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ACCESS_TOKEN_VERIFIER)
      .useValue(verifier)
      .overrideProvider(DPOP_PROOF_VERIFIER)
      .useValue({ verify: () => Promise.resolve() } satisfies DpopProofVerifier)
      .overrideProvider(PersonalVaultService)
      .useValue({
        approvePairing: () => Promise.resolve(result),
        rotate: () => Promise.resolve(result),
      })
      .compile();
    const statusApp = moduleRef.createNestApplication<NestFastifyApplication>(
      createFastifyAdapter({ NODE_ENV: "test" }),
      { logger: false },
    );
    await statusApp.init();
    await statusApp.getHttpAdapter().getInstance().ready();
    try {
      const headers = {
        authorization: "DPoP token-a",
        dpop: "test-harness-proof",
        "content-type": "application/json",
        "idempotency-key": "018fb9d8-3ec5-7e8b-a512-35f8ff523610",
        "if-match": '"pv2:current"',
      };
      const approval = await statusApp.inject({
        method: "POST",
        url: "/v1/personal/vault/device-pairings/018fb9d8-3ec5-7e8b-a512-35f8ff523611/approval",
        headers,
        payload: {},
      });
      const rotation = await statusApp.inject({
        method: "POST",
        url: "/v1/personal/vault/rotations",
        headers,
        payload: {},
      });
      expect(approval.statusCode).toBe(200);
      expect(rotation.statusCode).toBe(200);
    } finally {
      await statusApp.close();
    }
  });
});
