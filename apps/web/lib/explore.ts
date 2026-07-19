export type Locale = "en" | "zh-CN";
export type CampusId = "tc" | "duluth" | "crookston" | "morris" | "rochester";
export type ExploreType = "place" | "service" | "event" | "course";

export interface ExploreItem {
  readonly id: string;
  readonly campus: CampusId;
  readonly type: ExploreType;
  readonly openNow: boolean;
  readonly title: { readonly en: string; readonly "zh-CN": string };
}

export interface ExploreFilters {
  readonly query: string;
  readonly locale: Locale;
  readonly campus: CampusId;
  readonly types: readonly ExploreType[];
  readonly onlyOpen: boolean;
}

export function filterExploreItems<T extends ExploreItem>(items: readonly T[], filters: ExploreFilters): T[] {
  const query = filters.query.trim().toLocaleLowerCase(filters.locale);
  return items.filter((item) => {
    const matchesQuery = item.title[filters.locale].toLocaleLowerCase(filters.locale).includes(query);
    const matchesType = filters.types.length === 0 || filters.types.includes(item.type);
    const matchesOpen = !filters.onlyOpen || item.openNow;
    return item.campus === filters.campus && matchesQuery && matchesType && matchesOpen;
  });
}
