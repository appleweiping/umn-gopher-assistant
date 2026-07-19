// @vitest-environment node

import { describe, expect, it } from "vitest";

import { answerQuestion } from "../lib/assistant";

describe("retrieval-only assistant", () => {
  it("attaches at least one source citation to every answer paragraph", async () => {
    const answer = answerQuestion({ campus: "tc", locale: "en", query: "When does the library close?" });

    expect(answer.state).toBe("answered");
    expect(answer.paragraphs.length).toBeGreaterThan(0);
    for (const paragraph of answer.paragraphs) {
      expect(paragraph.citationIds.length).toBeGreaterThan(0);
    }
  });

  it("returns an explicit no-results state instead of inventing an answer", async () => {
    const answer = answerQuestion({ campus: "crookston", locale: "en", query: "quantum dragon parking" });

    expect(answer).toMatchObject({ state: "no-results", paragraphs: [] });
  });

  it("localizes source labels in a Chinese answer", () => {
    const answer = answerQuestion({ campus: "tc", locale: "zh-CN", query: "图书馆几点闭馆？" });

    expect(answer.citations[0]?.label).toBe("明尼苏达大学图书馆");
  });
});
