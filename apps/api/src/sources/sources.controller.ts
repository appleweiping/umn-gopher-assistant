import { BadRequestException, Controller, Get, Headers, Inject, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { CampusIdSchema, type SourceDescriptor } from "@umn-gopher-assistant/contracts";

import { SOURCE_REPOSITORY, type SourceRepository } from "../repositories/ports.js";
import { createEntityTag, ifNoneMatchMatches } from "../http/entity-tag.js";
import { paginateCursorPage, parsePageLimit, type CursorPage } from "../http/pagination.js";

@Controller("v1/sources")
export class SourcesController {
  constructor(@Inject(SOURCE_REPOSITORY) private readonly sourceRepository: SourceRepository) {}

  @Get()
  async list(
    @Query("campusId") campusId: string | undefined,
    @Query("cursor") cursor: string | undefined,
    @Query("limit") limitValue: string | undefined,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CursorPage<SourceDescriptor> | undefined> {
    const parsedCampusId = campusId === undefined ? undefined : CampusIdSchema.safeParse(campusId);
    if (parsedCampusId !== undefined && !parsedCampusId.success) {
      throw new BadRequestException("campusId must identify a supported campus");
    }
    const limit = parsePageLimit(limitValue);
    const sources = await this.sourceRepository.list(parsedCampusId?.data);
    const page = paginateCursorPage(sources, cursor, limit, "sources");
    const etag = createEntityTag(page);
    reply.header("ETag", etag);
    if (ifNoneMatchMatches(ifNoneMatch, etag)) {
      reply.status(304);
      return undefined;
    }
    return page;
  }
}
