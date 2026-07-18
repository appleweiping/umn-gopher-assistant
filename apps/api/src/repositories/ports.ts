import type {
  CampusId,
  CampusMetadata,
  CampusWorldManifest,
  SourceDescriptor,
} from "@umn-gopher-assistant/contracts";

export const CAMPUS_REPOSITORY = Symbol("CAMPUS_REPOSITORY");
export const SOURCE_REPOSITORY = Symbol("SOURCE_REPOSITORY");
export const WORLD_MANIFEST_REPOSITORY = Symbol("WORLD_MANIFEST_REPOSITORY");

export interface CampusRepository {
  list(): Promise<readonly CampusMetadata[]>;
}

export interface SourceRepository {
  list(campusId?: CampusId): Promise<readonly SourceDescriptor[]>;
}

export interface WorldManifestRepository {
  findByCampusId(campusId: string): Promise<CampusWorldManifest | null>;
}
