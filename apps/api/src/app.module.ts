import { Module } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";

import { AuthModule } from "./auth/auth.module.js";
import { CampusesController } from "./campuses/campuses.controller.js";
import { EventsController } from "./catalog/events.controller.js";
import { CATALOG_CLOCK } from "./catalog/catalog-range.js";
import { ConfiguredPublicCatalogGateway, PUBLIC_CATALOG_GATEWAY } from "./catalog/public-catalog.gateway.js";
import { PublicCatalogService } from "./catalog/public-catalog.service.js";
import { SessionsController } from "./catalog/sessions.controller.js";
import { BoundedSourceObservationSink, SOURCE_OBSERVATION_SINK } from "./catalog/source-observation.sink.js";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";
import { ProblemDetailsFilter } from "./http/problem-details.filter.js";
import { RequestIdInterceptor } from "./http/request-id.interceptor.js";
import { InMemoryCampusRepository } from "./repositories/in-memory-campus.repository.js";
import { InMemorySourceRepository } from "./repositories/in-memory-source.repository.js";
import { InMemoryWorldManifestRepository } from "./repositories/in-memory-world-manifest.repository.js";
import { CAMPUS_REPOSITORY, SOURCE_REPOSITORY, WORLD_MANIFEST_REPOSITORY } from "./repositories/ports.js";
import { SourcesController } from "./sources/sources.controller.js";
import { WorldsController } from "./worlds/worlds.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [
    CampusesController,
    EventsController,
    HealthController,
    SessionsController,
    SourcesController,
    WorldsController,
  ],
  providers: [
    HealthService,
    PublicCatalogService,
    { provide: CATALOG_CLOCK, useValue: () => new Date() },
    { provide: SOURCE_OBSERVATION_SINK, useClass: BoundedSourceObservationSink },
    { provide: PUBLIC_CATALOG_GATEWAY, useFactory: () => new ConfiguredPublicCatalogGateway() },
    { provide: CAMPUS_REPOSITORY, useClass: InMemoryCampusRepository },
    { provide: SOURCE_REPOSITORY, useClass: InMemorySourceRepository },
    { provide: WORLD_MANIFEST_REPOSITORY, useClass: InMemoryWorldManifestRepository },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestIdInterceptor },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest modules are decorator metadata containers.
export class AppModule {}
