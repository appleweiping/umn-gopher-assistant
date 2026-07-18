import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

import { CampusesController } from "./campuses/campuses.controller.js";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";
import { ProblemDetailsFilter } from "./http/problem-details.filter.js";
import { InMemoryCampusRepository } from "./repositories/in-memory-campus.repository.js";
import { InMemorySourceRepository } from "./repositories/in-memory-source.repository.js";
import { InMemoryWorldManifestRepository } from "./repositories/in-memory-world-manifest.repository.js";
import { CAMPUS_REPOSITORY, SOURCE_REPOSITORY, WORLD_MANIFEST_REPOSITORY } from "./repositories/ports.js";
import { SourcesController } from "./sources/sources.controller.js";
import { WorldsController } from "./worlds/worlds.controller.js";

@Module({
  controllers: [CampusesController, HealthController, SourcesController, WorldsController],
  providers: [
    HealthService,
    { provide: CAMPUS_REPOSITORY, useClass: InMemoryCampusRepository },
    { provide: SOURCE_REPOSITORY, useClass: InMemorySourceRepository },
    { provide: WORLD_MANIFEST_REPOSITORY, useClass: InMemoryWorldManifestRepository },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest modules are decorator metadata containers.
export class AppModule {}
