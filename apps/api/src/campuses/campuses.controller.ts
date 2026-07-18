import { Controller, Get, Inject } from "@nestjs/common";
import type { CampusMetadata } from "@umn-gopher-assistant/contracts";

import { CAMPUS_REPOSITORY, type CampusRepository } from "../repositories/ports.js";

@Controller("v1/campuses")
export class CampusesController {
  constructor(@Inject(CAMPUS_REPOSITORY) private readonly campusRepository: CampusRepository) {}

  @Get()
  list(): Promise<readonly CampusMetadata[]> {
    return this.campusRepository.list();
  }
}
