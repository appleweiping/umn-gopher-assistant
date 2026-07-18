import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { createEntityTag } from "../src/http/entity-tag.js";
import { paginateCursorPage, parsePageLimit } from "../src/http/pagination.js";

describe("cursor pagination", () => {
  it("returns an opaque cursor that advances to the next page", () => {
    const first = paginateCursorPage(["a", "b", "c", "d", "e"], undefined, 2, "sources");
    expect(first.items).toEqual(["a", "b"]);
    expect(first.nextCursor).toBeTypeOf("string");
    if (first.nextCursor === null) {
      throw new TypeError("Expected the first page to provide a cursor");
    }

    const second = paginateCursorPage(["a", "b", "c", "d", "e"], first.nextCursor, 2, "sources");
    expect(second.items).toEqual(["c", "d"]);
    expect(second.nextCursor).toBeTypeOf("string");
  });

  it("validates limits at the API boundary", () => {
    expect(parsePageLimit(undefined)).toBe(25);
    expect(parsePageLimit("100")).toBe(100);
    expect(() => parsePageLimit("0")).toThrow(BadRequestException);
    expect(() => parsePageLimit("1.5")).toThrow(BadRequestException);
    expect(() => parsePageLimit("101")).toThrow(BadRequestException);
  });

  it("creates stable content-sensitive entity tags", () => {
    expect(createEntityTag({ value: 1 })).toBe(createEntityTag({ value: 1 }));
    expect(createEntityTag({ value: 1 })).not.toBe(createEntityTag({ value: 2 }));
  });
});
