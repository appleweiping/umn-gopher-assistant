import { Injectable } from "@nestjs/common";
import { sources } from "@umn-gopher-assistant/config";
import type { CampusId, SourceDescriptor } from "@umn-gopher-assistant/contracts";

import type { SourceRepository } from "./ports.js";

@Injectable()
export class InMemorySourceRepository implements SourceRepository {
  list(campusId?: CampusId): Promise<readonly SourceDescriptor[]> {
    if (campusId === undefined) {
      return Promise.resolve(sources);
    }
    return Promise.resolve(sources.filter((source) => source.campusIds.includes(campusId)));
  }
}
