import campusesJson from "../data/campuses.json" with { type: "json" };
import sourcesJson from "../data/sources.json" with { type: "json" };

import { CampusMetadataSchema, SourceDescriptorSchema } from "@umn-gopher-assistant/contracts";

export const campuses = Object.freeze(CampusMetadataSchema.array().parse(campusesJson));
export const sources = Object.freeze(SourceDescriptorSchema.array().parse(sourcesJson));
