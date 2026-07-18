import { BadRequestException, Controller, Get, Inject, Query } from "@nestjs/common";
import { CampusIdSchema, type SourceDescriptor } from "@umn-gopher-assistant/contracts";

import { SOURCE_REPOSITORY, type SourceRepository } from "../repositories/ports.js";

@Controller("v1/sources")
export class SourcesController {
  constructor(@Inject(SOURCE_REPOSITORY) private readonly sourceRepository: SourceRepository) {}

  @Get()
  list(@Query("campusId") campusId?: string): Promise<readonly SourceDescriptor[]> {
    if (campusId === undefined) {
      return this.sourceRepository.list();
    }
    const parsed = CampusIdSchema.safeParse(campusId);
    if (!parsed.success) {
      throw new BadRequestException("campusId must identify a supported campus");
    }
    return this.sourceRepository.list(parsed.data);
  }
}
