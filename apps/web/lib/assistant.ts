export type AssistantCampusId = "tc" | "duluth" | "crookston" | "morris" | "rochester";
export type AssistantLocale = "en" | "zh-CN";

export interface AssistantAnswer {
  readonly state: "answered" | "stale" | "conflict" | "no-results";
  readonly paragraphs: readonly { readonly text: string; readonly citationIds: readonly string[] }[];
  readonly citations: readonly { readonly id: string; readonly label: string; readonly url: string }[];
}

const librarySources: Record<
  AssistantCampusId,
  { readonly label: Record<AssistantLocale, string>; readonly url: string }
> = {
  tc: {
    label: { en: "University Libraries", "zh-CN": "明尼苏达大学图书馆" },
    url: "https://www.lib.umn.edu/",
  },
  duluth: {
    label: { en: "Kathryn A. Martin Library", "zh-CN": "凯瑟琳·马丁图书馆" },
    url: "https://lib.d.umn.edu/",
  },
  crookston: {
    label: { en: "Roger D. Moe Library", "zh-CN": "罗杰·D·莫图书馆" },
    url: "https://crk.umn.edu/library",
  },
  morris: {
    label: { en: "Rodney A. Briggs Library", "zh-CN": "罗德尼·A·布里格斯图书馆" },
    url: "https://library.morris.umn.edu/",
  },
  rochester: {
    label: { en: "Library and Information Commons", "zh-CN": "图书馆与信息共享空间" },
    url: "https://r.umn.edu/student-life/library-and-information-commons",
  },
};

export function answerQuestion(input: {
  readonly campus: AssistantCampusId;
  readonly locale: AssistantLocale;
  readonly query: string;
}): AssistantAnswer {
  const normalized = input.query.toLocaleLowerCase(input.locale);
  if (!/library|hours|close|图书馆|闭馆|几点/u.test(normalized)) {
    return { state: "no-results", paragraphs: [], citations: [] };
  }

  const citationId = `${input.campus}-library`;
  const source = librarySources[input.campus];
  return {
    state: "answered",
    paragraphs: [
      {
        text:
          input.locale === "zh-CN"
            ? "营业时间会随学期和节假日变化，请在出发前打开官方来源核对。"
            : "Hours vary by term and holiday. Open the cited official source before leaving.",
        citationIds: [citationId],
      },
    ],
    citations: [{ id: citationId, label: source.label[input.locale], url: source.url }],
  };
}
