import { Controller, Get, Headers, Query, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { AcademicSession, SourceObservation } from "@umn-gopher-assistant/contracts";

import { Public } from "../auth/auth.decorators.js";
import { ifNoneMatchMatches } from "../http/entity-tag.js";
import { createCatalogPageEntityTag } from "./catalog-etag.js";
import { parseCatalogQuery } from "./catalog-query.js";
import type { CatalogRange } from "./catalog-range.js";
import { PublicCatalogService, type RetrievalCoverage } from "./public-catalog.service.js";

interface AcademicSessionPage {
  readonly items: readonly AcademicSession[];
  readonly nextCursor: string | null;
  readonly range: CatalogRange;
  readonly retrievalCoverage: RetrievalCoverage;
  readonly sourceObservations: readonly SourceObservation[];
}

@Controller("v1/academics/sessions")
export class SessionsController {
  constructor(private readonly catalog: PublicCatalogService) {}

  @Get()
  @Public()
  async list(
    @Query() rawQuery: Readonly<Record<string, unknown>>,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AcademicSessionPage | undefined> {
    reply.header("Cache-Control", "no-store");
    const page = await this.catalog.listSessions(parseCatalogQuery(rawQuery));
    const etag = createCatalogPageEntityTag(page);
    reply.header("ETag", etag);
    if (ifNoneMatchMatches(ifNoneMatch, etag)) {
      reply.status(304);
      return undefined;
    }
    return page;
  }
}
