import { Injectable } from "@nestjs/common";
import { campuses } from "@umn-gopher-assistant/config";
import type { CampusMetadata } from "@umn-gopher-assistant/contracts";

import type { CampusRepository } from "./ports.js";

@Injectable()
export class InMemoryCampusRepository implements CampusRepository {
  list(): Promise<readonly CampusMetadata[]> {
    return Promise.resolve(campuses);
  }
}
