import { Controller, Get, Headers, Inject, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { CampusMetadata } from "@umn-gopher-assistant/contracts";

import { Public } from "../auth/auth.decorators.js";
import { CAMPUS_REPOSITORY, type CampusRepository } from "../repositories/ports.js";
import { createEntityTag, ifNoneMatchMatches } from "../http/entity-tag.js";

@Controller("v1/campuses")
export class CampusesController {
  constructor(@Inject(CAMPUS_REPOSITORY) private readonly campusRepository: CampusRepository) {}

  @Get()
  @Public()
  async list(
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<readonly CampusMetadata[] | undefined> {
    const campuses = await this.campusRepository.list();
    const etag = createEntityTag(campuses);
    reply.header("ETag", etag);
    if (ifNoneMatchMatches(ifNoneMatch, etag)) {
      reply.status(304);
      return undefined;
    }
    return campuses;
  }
}
