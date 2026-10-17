// The brief book's language and its fact lines (docs/info/88 「简报书」): one
// language for the write-up, the opening and the program's own labels, and a
// compact facts line whose numbers the full line still holds.

import { describe, expect, test } from "bun:test";
import { LOCALES } from "../../../src/i18n/locale";
import { MaterialRegistry } from "../../../src/info/dossier/registry";
import { openingPrompt } from "../../../src/info/issue/opening-record";
import { planIssue } from "../../../src/info/issue/plan";
import { issueBookName, issueCoverLine, issueEpubInput, issueTitle, longDate } from "../../../src/info/issue/render";
import { bookLanguageInstruction, bookLocale } from "../../../src/info/topic-search/book-language";
import { checkWritten, composePrompt, factsText, type ComposeInput } from "../../../src/info/topic-search/compose";
import { dateOnly, factsLine } from "../../../src/info/topic-search/facts-line";
import { numbersIn } from "../../../src/info/topic-search/model-io";
import type { ResultFacts, TopicSearchResult, TopicSearchResultItem } from "../../../src/info/topic-search/result-types";
import type { TopicSearch } from "../../../src/info/topic-search/types";

describe("the book's language", () => {
  test("an explicit setting wins; auto follows the system language and then English", () => {
    expect(bookLocale("ja", ["zh-CN"])).toBe("ja");
    expect(bookLocale("auto", ["zh-Hans-CN", "en"])).toBe("zh-CN");
    expect(bookLocale("auto", ["pt-BR"])).toBe("pt");
    expect(bookLocale("auto", [])).toBe("en");
    expect(bookLocale("auto", ["sv-SE"])).toBe("en");
  });

  test("the instruction names the language, also under auto", () => {
    expect(bookLanguageInstruction("auto", ["zh-CN"])).toContain("简体中文");
    expect(bookLanguageInstruction("auto", [])).toContain("English");
    expect(bookLanguageInstruction("de", ["zh-CN"])).toContain("Deutsch");
    expect(bookLanguageInstruction("de", ["zh-CN"])).not.toContain("简体中文");
  });

  test("the write-up prompt carries the language and keeps original titles as they are", () => {
    const prompt = composePrompt(composeInput([pageItem("E1")], bookLanguageInstruction("auto", ["zh-CN"])));
    expect(prompt.system).toContain("简体中文");
    expect(prompt.system).toContain("Titles of papers, posts and repositories, and names you quote, stay in their original language");
  });

  test("the opening prompt gets the same explicit language, with no fallback to the items' own", () => {
    const plan = planIssue([resultOf([pageItem("E1", { summary: "S.", body: ["B."] })])], TOPICS)!;
    const system = openingPrompt(plan, [], bookLanguageInstruction("auto", ["ko"])).system;
    expect(system).toContain("한국어");
    expect(system).not.toContain("the language the items");
  });
});

describe("the book's own words follow its locale", () => {
  const plan = () =>
    planIssue(
      [
        resultOf(
          [
            pageItem("E1", { summary: "结论一。", body: ["正文。"], unknown: "还不清楚。" }),
            pageItem("E2", { score: 10 }),
          ],
          { kind: "first", overview: { text: "全景，见 E1。", cites: ["E1"] } },
        ),
      ],
      TOPICS,
    )!;

  test("zh-CN: labels, headings, title, dates and the EPUB's language", () => {
    const meta = { number: 7, date: "2026-10-15", locale: "zh-CN" as const };
    const input = issueEpubInput(plan(), meta);
    expect(input.language).toBe("zh-CN");
    expect(input.sections.map((s) => s.heading)).toEqual(["目录", "Story E1", "札记", "附录：AI for science"]);
    expect(input.sections[0].html).toContain('<a href="section-002.xhtml">AI for science</a>：结论一。');
    expect(input.sections[0].html).toContain('<a href="section-003.xhtml">札记</a>：');
    expect(input.sections[0].html).toContain('<a href="section-004.xhtml">附录：AI for science</a>，这个主题第一次检索的全景。');
    expect(input.sections[1].html).toContain("<strong>尚不清楚。</strong> 还不清楚。");
    expect(input.sections[1].html).toContain("example.org; 2026-10-14");
    expect(input.title).toBe(`每日简报第 7 期，${longDate("2026-10-15", "zh-CN")}`);
    expect(input.title).toContain("2026年10月15日");
    expect(issueBookName(meta)).toBe("每日简报第 7 期 · 10月15日");
    expect(issueCoverLine("2026-10-15", 4, "zh-CN")).toBe("10月15日简报 · 4 条");
    expect(input.cover?.svg).toContain("第 7 期");
    // No English label is left in the program's words.
    const all = input.sections.map((s) => s.html).join("\n");
    for (const english of ["Contents", "Notes", "Annex", "Not yet known", "Original:"]) expect(all).not.toContain(english);
  });

  test("every locale draws every label (no key falls back to its own name)", () => {
    for (const locale of LOCALES) {
      const input = issueEpubInput(plan(), { number: 1, date: "2026-10-15", locale });
      const everything = [issueTitle({ number: 1, date: "2026-10-15", locale }), ...input.sections.map((s) => `${s.heading}\n${s.html}`)].join("\n");
      expect(everything).not.toMatch(/issue\.(book|facts)\./);
      expect(input.language).toBe(locale);
    }
  });

  test("English stays what it was", () => {
    const input = issueEpubInput(plan(), { number: 7, date: "2026-10-15", locale: "en" });
    expect(input.sections.map((s) => s.heading)).toEqual(["Contents", "Story E1", "Notes", "Annex: AI for science"]);
    expect(input.sections[1].html).toContain("<strong>Not yet known.</strong>");
  });
});

describe("the facts line in the book", () => {
  const paper = (authors: string[], publishedAt: string | null): ResultFacts => ({ kind: "paper", arxivId: "2610.01234", authors, publishedAt });

  test("a paper names three authors and then et al.; a date is a day", () => {
    const five = paper(["A. One", "B. Two", "C. Three", "D. Four", "E. Five"], "2026-10-14T17:59:59Z");
    expect(factsLine(five, "en")).toBe("arXiv 2610.01234; A. One, B. Two, C. Three et al.; 2026-10-14");
    expect(factsLine(five, "zh-CN")).toBe("arXiv 2610.01234; A. One, B. Two, C. Three 等; 2026-10-14");
    expect(factsLine(paper(["A. One", "B. Two", "C. Three"], "2026-10-14"), "en")).toBe("arXiv 2610.01234; A. One, B. Two, C. Three; 2026-10-14");
    expect(factsLine(paper(["A. One"], null), "en")).toBe("arXiv 2610.01234; A. One; date unknown");
    // The prompt keeps all five and the timestamp.
    expect(factsText(five)).toContain("E. Five");
    expect(factsText(five)).toContain("2026-10-14T17:59:59Z");
  });

  test("a repo's dates are days, its counts follow the locale; a post's time is a day", () => {
    const repo: ResultFacts = {
      kind: "repo",
      fullName: "acme/tool",
      lookedUp: true,
      stars: 1,
      forks: 4,
      lastCommitAt: "2026-10-13T08:00:00Z",
      release: { tag: "v1.2", publishedAt: "2026-10-01T10:00:00Z" },
      license: "MIT",
    };
    expect(factsLine(repo, "en")).toBe("acme/tool; 1 star; 4 forks; last commit 2026-10-13; release v1.2 2026-10-01; license MIT");
    expect(factsLine(repo, "zh-CN")).toBe("acme/tool; 1 星标; 4 复刻; 最近提交 2026-10-13; 发布 v1.2 2026-10-01; 许可证 MIT");
    const post: ResultFacts = { kind: "post", handle: "lab", name: "Lab", postedAt: Date.UTC(2026, 9, 14, 9, 30), counts: { likes: 12, reposts: 3, replies: 1, quotes: 0, views: null } };
    expect(factsLine(post, "en")).toBe("@lab; 2026-10-14; 12 likes, 3 reposts, 1 reply");
    expect(factsLine({ kind: "page", host: "example.org", author: "Ann", publishedAt: "2026-10-14T00:00:00Z" }, "en")).toBe("example.org; Ann; 2026-10-14");
    expect(dateOnly("not a date")).toBe("not a date");
  });

  const samples: ResultFacts[] = [
    paper(["A", "B", "C", "D"], "2026-10-14T17:59:59Z"),
    { kind: "repo", fullName: "acme/tool", lookedUp: true, stars: 120, forks: 4, lastCommitAt: "2026-10-13T08:05:09Z", release: { tag: "v1.2", publishedAt: "2026-10-01T10:00:00Z" }, license: "MIT" },
    { kind: "page", host: "example.org", author: null, publishedAt: "2026-10-14T06:07:08Z" },
    { kind: "post", handle: "lab", name: "Lab", postedAt: Date.UTC(2026, 9, 14, 9, 30), counts: { likes: 12, reposts: 3, replies: 1, quotes: 0, views: null } },
  ];

  test("the book's line holds no number the full line lacks", () => {
    for (const f of samples) {
      const full = new Set(numbersIn(factsText(f)));
      for (const locale of LOCALES) {
        for (const n of numbersIn(factsLine(f, locale))) expect({ f: f.kind, locale, n, ok: full.has(n) }).toMatchObject({ ok: true });
      }
    }
  });

  test("the number check still takes a number only the full facts hold", () => {
    const facts = paper(["A", "B", "C", "D"], "2026-10-14T17:59:59Z");
    expect(numbersIn(factsLine(facts, "en"))).not.toContain("17");
    const item = pageItem("E1", { kind: "paper", facts });
    const reply = (text: string) =>
      JSON.stringify({ overview: { text: "See E1.", cites: ["E1"] }, items: [{ e: "E1", conclusion: text, body: ["Submitted at 17:59."], unknown: null }] });
    expect(checkWritten(reply("A paper from October 14."), composeInput([item], "")).problems).toEqual([]);
    const wrong = checkWritten(reply("A paper from October 14."), composeInput([pageItem("E1", { kind: "paper", facts: paper(["A"], "2026-10-14") })], ""));
    expect(wrong.problems.join(" ")).toContain("17");
  });
});

// --- fixtures ---------------------------------------------------------------

const TOPIC: TopicSearch = {
  id: "ts-0000aaaa",
  name: "AI for science",
  concernId: null,
  scope: "AI used to do science",
  subtopics: [],
  want: [],
  avoid: [],
  judgments: [],
  anchors: [],
  queries: [],
  answers: [],
  status: "active",
  revision: 1,
  createdAt: 0,
  lastRunAt: null,
};

const TOPICS = [{ searchId: "ts-0000aaaa", name: "AI for science", subtopics: [] }];

function pageItem(id: string, over: Partial<TopicSearchResultItem> = {}): TopicSearchResultItem {
  return {
    id,
    key: `url:https://example.org/${id}`,
    keys: [],
    kind: "page",
    subtopic: null,
    title: `Story ${id}`,
    titleFrom: "original",
    summary: null,
    facts: { kind: "page", host: "example.org", author: null, publishedAt: "2026-10-14" },
    links: { original: `https://example.org/${id}`, posts: [] },
    materials: [],
    verify: { status: "read", reason: null, discrepancies: [], checked: { match: 0, mismatch: 0, absent: 0 } },
    continuing: null,
    score: 80,
    ...over,
  };
}

function resultOf(items: TopicSearchResultItem[], over: Partial<TopicSearchResult> = {}): TopicSearchResult {
  return {
    version: 1,
    id: "topic-search-ts-0000aaaa-2026-10-15",
    searchId: "ts-0000aaaa",
    name: "AI for science",
    kind: "daily",
    date: "2026-10-15",
    createdAt: 0,
    window: { since: 0, until: 0 },
    empty: items.length === 0,
    writeup: "model",
    overview: null,
    groups: [],
    quiet: [],
    items,
    materials: [],
    questions: [],
    stats: {} as TopicSearchResult["stats"],
    runDir: "topic-search-runs/r",
    ...over,
  };
}

function composeInput(items: TopicSearchResultItem[], language: string): ComposeInput {
  return {
    topic: TOPIC,
    kind: "daily",
    items,
    registry: new MaterialRegistry("r", { write: async () => {} }),
    profile: [],
    questions: [],
    language,
    earlier: [],
  };
}
