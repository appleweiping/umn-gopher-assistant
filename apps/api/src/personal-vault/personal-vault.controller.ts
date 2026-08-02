import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Param,
  Post,
  Put,
  Req,
  Res,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { DevicePairingViewV2 } from "@umn-gopher-assistant/contracts";

import { RequireScopes } from "../auth/auth.decorators.js";
import type { AuthPrincipal, RequestWithAuthPrincipal } from "../auth/auth.types.js";
import { createEntityTag, ifNoneMatchMatches } from "../http/entity-tag.js";
import type {
  PairingWriteResult,
  VaultSnapshotRecord,
  VaultWriteResult,
} from "./personal-vault.repository.js";
import { PersonalVaultService, type VaultBootstrapResponse } from "./personal-vault.service.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function principal(request: FastifyRequest & RequestWithAuthPrincipal): AuthPrincipal {
  if (request.authPrincipal === undefined) {
    throw new InternalServerErrorException("Authenticated route did not receive an auth principal");
  }
  return request.authPrincipal;
}

function requireJson(request: FastifyRequest): void {
  const contentType = request.headers["content-type"];
  if (typeof contentType !== "string" || !/^application\/json(?:\s*;.*)?$/iu.test(contentType)) {
    throw new UnsupportedMediaTypeException("Personal vault mutations require application/json");
  }
}

function parsePairingId(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new BadRequestException("pairingId must be a canonical lowercase UUID");
  }
  return value;
}

function writeHeaders(reply: FastifyReply, result: VaultWriteResult | PairingWriteResult): void {
  reply.header("Cache-Control", "no-store");
  reply.header("ETag", result.etag);
  reply.header("Idempotency-Replayed", result.replayed ? "true" : "false");
}

@Controller("v1/personal/vault")
export class PersonalVaultController {
  constructor(private readonly vault: PersonalVaultService) {}

  @Get("bootstrap")
  @RequireScopes("personal:read")
  async bootstrap(
    @Req() request: FastifyRequest & RequestWithAuthPrincipal,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<VaultBootstrapResponse> {
    reply.header("Cache-Control", "no-store");
    return this.vault.bootstrap(principal(request));
  }

  @Get()
  @RequireScopes("personal:read")
  async read(
    @Req() request: FastifyRequest & RequestWithAuthPrincipal,
    @Headers("x-vault-read-proof") readProof: string | undefined,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<VaultSnapshotRecord["snapshot"] | undefined> {
    reply.header("Cache-Control", "no-store");
    const result = await this.vault.read(principal(request), readProof);
    reply.header("ETag", result.etag);
    if (ifNoneMatchMatches(ifNoneMatch, result.etag)) {
      reply.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }
    return result.snapshot;
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireScopes("personal:write")
  async create(
    @Body() body: unknown,
    @Req() request: FastifyRequest & RequestWithAuthPrincipal,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<VaultSnapshotRecord["snapshot"]> {
    requireJson(request);
    const result = await this.vault.create(principal(request), body, ifNoneMatch, idempotencyKey);
    writeHeaders(reply, result);
    reply.header("Location", "/v1/personal/vault");
    return result.snapshot;
  }

  @Put("payload")
  @RequireScopes("personal:write")
  async updatePayload(
    @Body() body: unknown,
    @Req() request: FastifyRequest & RequestWithAuthPrincipal,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<VaultSnapshotRecord["snapshot"]> {
    requireJson(request);
    const result = await this.vault.updatePayload(principal(request), body, ifMatch, idempotencyKey);
    writeHeaders(reply, result);
    return result.snapshot;
  }

  @Get("device-pairings")
  @RequireScopes("personal:read")
  async listPairings(
    @Req() request: FastifyRequest & RequestWithAuthPrincipal,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ readonly items: readonly DevicePairingViewV2[] } | undefined> {
    reply.header("Cache-Control", "no-store");
    const items = await this.vault.listPairings(principal(request));
    const body = { items };
    const etag = createEntityTag(body);
    reply.header("ETag", etag);
    if (ifNoneMatchMatches(ifNoneMatch, etag)) {
      reply.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }
    return body;
  }

  @Post("device-pairings")
  @HttpCode(HttpStatus.CREATED)
  @RequireScopes("personal:write")
  async createPairing(
    @Body() body: unknown,
    @Req() request: FastifyRequest & RequestWithAuthPrincipal,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<DevicePairingViewV2> {
    requireJson(request);
    const result = await this.vault.createPairing(principal(request), body, ifMatch, idempotencyKey);
    writeHeaders(reply, result);
    reply.header("Location", `/v1/personal/vault/device-pairings/${result.pairing.id}`);
    return result.pairing;
  }

  @Delete("device-pairings/:pairingId")
  @RequireScopes("personal:write")
  async cancelPairing(
    @Param("pairingId") rawPairingId: string,
    @Req() request: FastifyRequest & RequestWithAuthPrincipal,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<DevicePairingViewV2> {
    const result = await this.vault.cancelPairing(
      principal(request),
      parsePairingId(rawPairingId),
      ifMatch,
      idempotencyKey,
    );
    writeHeaders(reply, result);
    return result.pairing;
  }

  @Post("device-pairings/:pairingId/approval")
  @HttpCode(HttpStatus.OK)
  @RequireScopes("personal:write")
  async approvePairing(
    @Param("pairingId") rawPairingId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest & RequestWithAuthPrincipal,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<VaultSnapshotRecord["snapshot"]> {
    requireJson(request);
    const result = await this.vault.approvePairing(
      principal(request),
      parsePairingId(rawPairingId),
      body,
      ifMatch,
      idempotencyKey,
    );
    writeHeaders(reply, result);
    return result.snapshot;
  }

  @Post("rotations")
  @HttpCode(HttpStatus.OK)
  @RequireScopes("personal:write")
  async rotate(
    @Body() body: unknown,
    @Req() request: FastifyRequest & RequestWithAuthPrincipal,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<VaultSnapshotRecord["snapshot"]> {
    requireJson(request);
    const result = await this.vault.rotate(principal(request), body, ifMatch, idempotencyKey);
    writeHeaders(reply, result);
    return result.snapshot;
  }
}
