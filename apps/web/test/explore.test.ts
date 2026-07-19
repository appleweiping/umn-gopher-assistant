// @vitest-environment node

import { describe, expect, it } from "vitest";

import { filterExploreItems } from "../lib/explore";

describe("explore filtering", () => {
  it("combines locale-aware text, type, campus, and open-now filters", async () => {
    const items = [
      {
        id: "1",
        campus: "tc",
        type: "place",
        openNow: true,
        title: { en: "Wilson Library", "zh-CN": "威尔逊图书馆" },
      },
      {
        id: "2",
        campus: "duluth",
        type: "event",
        openNow: true,
        title: { en: "Lake walk", "zh-CN": "湖畔步行" },
      },
      {
        id: "3",
        campus: "tc",
        type: "service",
        openNow: false,
        title: { en: "One Stop", "zh-CN": "一站式学生服务" },
      },
    ] as const;

    expect(
      filterExploreItems(items, {
        query: "图书馆",
        locale: "zh-CN",
        campus: "tc",
        types: ["place"],
        onlyOpen: true,
      }),
    ).toEqual([items[0]]);
  });

  it("returns all matching types when no type filter is selected", async () => {
    const items = [
      {
        id: "1",
        campus: "morris",
        type: "course",
        openNow: false,
        title: { en: "Biology", "zh-CN": "生物学" },
      },
      {
        id: "2",
        campus: "morris",
        type: "service",
        openNow: true,
        title: { en: "Biology tutoring", "zh-CN": "生物学辅导" },
      },
    ] as const;

    expect(
      filterExploreItems(items, {
        query: "biology",
        locale: "en",
        campus: "morris",
        types: [],
        onlyOpen: false,
      }),
    ).toHaveLength(2);
  });
});
