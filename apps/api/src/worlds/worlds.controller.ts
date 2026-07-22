import { Controller, Get, Header, Headers, Inject, NotFoundException, Param, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { CampusIdSchema, type CampusWorldManifest } from "@umn-gopher-assistant/contracts";

import { Public } from "../auth/auth.decorators.js";
import { ifNoneMatchMatches } from "../http/entity-tag.js";
import { WORLD_MANIFEST_REPOSITORY, type WorldManifestRepository } from "../repositories/ports.js";

@Controller("v1/worlds")
export class WorldsController {
  constructor(
    @Inject(WORLD_MANIFEST_REPOSITORY)
    private readonly worldManifestRepository: WorldManifestRepository,
  ) {}

  @Get(":campusId/manifest")
  @Header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  @Public()
  async getManifest(
    @Param("campusId") campusId: string,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CampusWorldManifest | undefined> {
    const parsedCampusId = CampusIdSchema.safeParse(campusId);
    if (!parsedCampusId.success) {
      throw new NotFoundException("World manifest not found");
    }
    const manifest = await this.worldManifestRepository.findByCampusId(parsedCampusId.data);
    if (manifest === null) {
      throw new NotFoundException("World manifest not found");
    }

    reply.header("ETag", manifest.etag);
    if (ifNoneMatchMatches(ifNoneMatch, manifest.etag)) {
      reply.status(304);
      return undefined;
    }
    return manifest;
  }
}
