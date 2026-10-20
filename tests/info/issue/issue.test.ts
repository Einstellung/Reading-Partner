// The nightly brief (docs/info/88 「简报书」, src/info/issue): the plan's
// initial rules, the rendered document, when a night is due, and two topics'
// results assembled into an EPUB that the reader's own EPUB path parses,
// paginates and outlines. Set ISSUE_SAMPLE=<path> to keep the EPUB.

import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { characterRuler, paginate } from "../../../src/reading/epub/paginate";
import { fulltextFrom } from "../../../src/reading/epub/fulltext";
import { parseEpub } from "../../../src/reading/epub/file/parse";
import { buildSectionedEpub } from "../../../src/workshop/bindery/build-article";
import {
  assembleIssue,
  dueIssues,
  emptyIssueState,
  noteClosed,
  runClosed,
  type IssueDeps,
} from "../../../src/info/issue/assemble";
import { MAIN_MAX, planIssue } from "../../../src/info/issue/plan";
import { issueBookName, issueCoverLine, issueEpubInput, longDate } from "../../../src/info/issue/render";
import { INFO_SHELF_FILE, ISSUE_BOX_KIND, issueBookOfItem, parseShelf } from "../../../src/info/issue/types";
import type { RegisteredMaterial } from "../../../src/info/dossier/registry";
import { firstPart, mergeRetry, retryPart, type TopicSearchResult, type TopicSearchResultItem } from "../../../src/info/topic-search/result-types";

function material(id: string, url: string, reader: RegisteredMaterial["reader"]): RegisteredMaterial {
  return { id, url, canonicalUrl: url, title: `Original ${id}`, author: null, publishedAt: null, reader, facts: {}, hash: id, sections: [], body: `materials/${id}.json` };
}

function item(id: string, score: number, over: Partial<TopicSearchResultItem> = {}): TopicSearchResultItem {
  return {
    id,
    key: `url:https://example.org/${id}-${score}`,
    keys: [],
    kind: "repo",
    subtopic: null,
    title: `A tool for ${id} at ${score}`,
    titleFrom: "original",
    summary: `Conclusion of ${id}.`,
    body: [`What happened with ${id}.`, `It likely matters for ${id}.`],
    unknown: `Whether ${id} holds up.`,
    facts: { kind: "repo", fullName: `acme/${id}`, lookedUp: true, stars: 120, forks: 4, lastCommitAt: "2026-10-13", release: null, license: "MIT" },
    links: { original: `https://github.com/acme/${id}`, posts: [] },
    materials: [],
    verify: { status: "read", reason: null, discrepancies: [], checked: { match: 0, mismatch: 0, absent: 0 } },
    continuing: null,
    score,
    ...over,
  };
}

function result(searchId: string, name: string, date: string, kind: "first" | "daily", items: TopicSearchResultItem[], over: Partial<TopicSearchResult> = {}): TopicSearchResult {
  return {
    version: 1,
    id: `topic-search-${searchId}-${date}`,
    searchId,
    name,
    kind,
    date,
    createdAt: 0,
    window: { since: 0, until: 0 },
    empty: items.length === 0,
    writeup: "model",
    overview: kind === "first" ? { text: "The field moved fast; see E1 and E2.", cites: ["E1"] } : null,
    groups: [],
    quiet: [],
    items,
    materials: [],
    questions: [],
    stats: { candidates: { x: 0, arxiv: 0 }, passedFloor: 0, pooled: 0, reranked: true, anchorMiss: 0, avoidBlocked: {}, subtopicItems: {}, modelCalls: 0 },
    runDir: "topic-search-runs/r",
    ...over,
  };
}

const TOPICS = [
  { searchId: "ts-0000aaaa", name: "AI for science", subtopics: [{ id: "s1", name: "Proteins" }] },
  { searchId: "ts-0000bbbb", name: "AI for engineering", subtopics: [] },
];

function nightResults(): TopicSearchResult[] {
  const science = result("ts-0000aaaa", "AI for science", "2026-10-15", "daily", [
    item("E1", 90, {
      subtopic: "s1",
      materials: ["M1", "M2"],
      verify: {
        status: "compared",
        reason: null,
        discrepancies: [{ post: "1", says: "the full training code is open", difference: "The repository holds inference code only.", evidence: "M2.§1", verdict: "mismatch" }],
        checked: { match: 1, mismatch: 1, absent: 0 },
      },
      links: { original: "https://github.com/acme/E1", posts: [{ statusId: "1", handle: "lab", name: "Lab", url: "https://x.com/lab/status/1", postedAt: 0, counts: { likes: 1, reposts: 0, replies: 0, quotes: 0, views: null }, text: "", truncated: false }] },
    }),
    item("E2", 30),
    item("E3", 80, {
      continuing: { previous: "topic-search-ts-0000aaaa-2026-10-14", post: "9", before: { likes: 100, reposts: 1, replies: 0, quotes: 0, views: null }, after: { likes: 400, reposts: 9, replies: 0, quotes: 0, views: null } },
      summary: null,
      body: [],
    }),
  ], { materials: [material("M1", "https://x.com/lab/status/1", "x"), material("M2", "https://github.com/acme/E1", "github")] });
  const engineering = result("ts-0000bbbb", "AI for engineering", "2026-10-15", "first", [item("E1", 70), item("E2", 60, { summary: null, body: [] })]);
  return [science, engineering];
}

test("the plan: entries by score, low scores and continuing items to Notes, a first look's panorama to the Annex", () => {
  const plan = planIssue(nightResults(), TOPICS)!;
  expect(plan.entries.map((p) => `${p.topic}/${p.subtopic ?? "-"} ${p.item.id}`)).toEqual([
    "AI for science/Proteins E1",
    "AI for engineering/- E1",
  ]);
  // E3 continues, E2 (engineering) has no written entry, E2 (science) scored under the line.
  expect(plan.notes.map((p) => `${p.searchId} ${p.item.id}`)).toEqual(["ts-0000aaaa E3", "ts-0000bbbb E2", "ts-0000aaaa E2"]);
  expect(plan.annex).toEqual([{ searchId: "ts-0000bbbb", topic: "AI for engineering", text: "The field moved fast; see E1 and E2.", cites: [{ id: "E1", title: "A tool for E1 at 70" }, { id: "E2", title: "A tool for E2 at 60" }] }]);
  expect(planIssue([result("ts-0000aaaa", "x", "2026-10-15", "daily", [])], TOPICS)).toBeNull();
  const many = planIssue([result("ts-0000aaaa", "x", "2026-10-15", "daily", Array.from({ length: 9 }, (_, i) => item(`E${i + 1}`, 99 - i)))], TOPICS)!;
  expect(many.entries.length).toBe(MAIN_MAX);
  // Nothing qualifies for the body: the best written item is promoted.
  const low = planIssue([result("ts-0000aaaa", "x", "2026-10-15", "daily", [item("E1", 10), item("E2", 20)])], TOPICS)!;
  expect(low.entries.map((p) => p.item.id)).toEqual(["E2"]);
});

test("the plan keeps MAIN_POSTS entries for post items when papers outscore them all (the 2026-10-15 shape)", () => {
  const withPost = (id: string, score: number) =>
    item(id, score, {
      kind: "post",
      links: { original: null, posts: [{ statusId: id, handle: "lab", name: "Lab", url: `https://x.com/lab/status/${id}`, postedAt: 0, counts: { likes: 1, reposts: 0, replies: 0, quotes: 0, views: null }, text: "", truncated: false }] },
    });
  const papers = Array.from({ length: 8 }, (_, i) => item(`E${i + 1}`, 80 - i));
  const posts = [withPost("E9", 66), withPost("E10", 50), withPost("E11", 47), withPost("E12", 44)];
  const plan = planIssue([result("ts-0000aaaa", "x", "2026-10-15", "first", [...papers, ...posts])], TOPICS)!;
  // Four papers by score, then the two best posts at or above NOTE_BELOW; E12 is under it.
  expect(plan.entries.map((p) => p.item.id)).toEqual(["E1", "E2", "E3", "E4", "E9", "E10"]);
  expect(plan.notes.map((p) => p.item.id)).toEqual(["E5", "E6", "E7", "E8", "E11", "E12"]);
  // Posts already in the top six by score take no extra place.
  const mixed = planIssue([result("ts-0000aaaa", "x", "2026-10-15", "daily", [withPost("E1", 90), ...papers.slice(1)])], TOPICS)!;
  expect(mixed.entries.map((p) => p.item.id)).toEqual(["E1", "E2", "E3", "E4", "E5", "E6"]);
});

test("the document: contents lines, entries, Notes with separators, the Annex; the cover line", () => {
  const input = issueEpubInput(planIssue(nightResults(), TOPICS)!, { number: 3, date: "2026-10-15", locale: "en" });
  expect(input.sections.map((s) => s.heading)).toEqual(["Contents", "A tool for E1 at 90", "A tool for E1 at 70", "Notes", "Annex: AI for engineering"]);
  const contents = input.sections[0].html;
  expect(contents).toContain('<a href="section-002.xhtml">AI for science / Proteins</a>: Conclusion of E1.');
  expect(contents).toContain('<a href="section-004.xhtml">Notes</a>: AI for science: A tool for E3 at 80;');
  expect(contents).toContain('<a href="section-005.xhtml">Annex: AI for engineering</a>');
  const entry = input.sections[1].html;
  expect(entry).toContain("<p><em>Conclusion of E1.</em></p>");
  expect(entry).toContain("<p><strong>Not yet known.</strong> Whether E1 holds up.</p>");
  expect(entry).toContain("acme/E1; 120 stars");
  expect(entry).toContain("<strong>Post and original differ.</strong>");
  expect(input.sections[3].html.split("<p>* * *</p>").length).toBe(3);
  expect(input.sections[4].html).toContain("see [1] and [2].");
  expect(input.title).toBe("Daily Brief No. 3, Thursday, October 15, 2026");
  expect(issueBookName({ number: 7, date: "2026-10-15", locale: "en" })).toBe("Daily Brief No. 7 · Oct 15");
  expect(input.cover?.svg).toContain("No. 3");
  expect(longDate("2026-10-15", "en")).toBe("Thursday, October 15, 2026");
  expect(issueCoverLine("2026-10-15", 4, "en")).toBe("Oct 15 brief · 4 items");
  expect(issueCoverLine("2026-10-05", 1, "en")).toBe("Oct 5 brief · 1 item");
});

test("a night is due when every active search's run closed, or at its end with what closed", () => {
  const end = () => 1000;
  let state = noteClosed(emptyIssueState(), { searchId: "a", kind: "daily", night: "2026-10-15", resultFile: "ra.json" });
  expect(dueIssues(state, ["a", "b"], 999, end)).toEqual([]);
  expect(dueIssues(state, ["a", "b"], 1000, end)).toEqual([{ key: "night:2026-10-15", date: "2026-10-15", files: ["ra.json"] }]);
  state = noteClosed(state, { searchId: "b", kind: "daily", night: "2026-10-15", resultFile: null });
  expect(dueIssues(state, ["a", "b"], 0, end).map((d) => d.files)).toEqual([["ra.json"]]);
  state = noteClosed(state, { searchId: "c", kind: "first", night: null, resultFile: "rc.json" });
  expect(dueIssues({ ...state, done: ["night:2026-10-15"] }, ["a", "b"], 0, end)).toEqual([{ key: "first:c", date: null, files: ["rc.json"] }]);
  const late = noteClosed({ ...emptyIssueState(), done: ["night:2026-10-15"] }, { searchId: "a", kind: "daily", night: "2026-10-15", resultFile: "ra.json" });
  expect(late.nights).toEqual({});
});

function world() {
  const files = new Map<string, string>();
  const library = new Map<string, { fileName: string; meta: unknown; bytes: Uint8Array }>();
  const attached: string[] = [];
  const box: { id: string; kind: string; cover: string; body: string; origin: { place: string; date: string } }[] = [];
  let ids = 0;
  const deps: IssueDeps = {
    files: { read: async (p) => files.get(p) ?? null, write: async (p, t) => void files.set(p, t) },
    topics: async () => TOPICS,
    activeSearchIds: async () => TOPICS.map((t) => t.searchId),
    buildEpub: buildSectionedEpub,
    importBook: async (bytes, fileName, meta) => {
      const hash = `h${library.size + 1}`;
      library.set(hash, { fileName, meta, bytes });
      return { hash };
    },
    attachOriginal: async (bookId, m) => {
      attached.push(`${bookId} ${m.url}`);
      return true;
    },
    putBox: async (item) => void box.push(item),
    newBoxItemId: () => `box-${++ids}`,
    nightEndAt: () => Number.MAX_SAFE_INTEGER,
    now: () => 5,
    today: () => "2026-10-15",
  };
  return { files, library, attached, box, deps };
}

describe("two topics' results become one issue", () => {
  const w = world();
  for (const r of nightResults()) w.files.set(`${r.id}.json`, JSON.stringify(r));

  test("the second run to close makes the night's issue: filed as kind issue, on the shelf, one box item", async () => {
    const [science, engineering] = nightResults();
    expect(await runClosed(w.deps, { searchId: science.searchId, kind: "daily", night: "2026-10-15", resultFile: `${science.id}.json` })).toEqual([]);
    const [made] = await runClosed(w.deps, { searchId: engineering.searchId, kind: "daily", night: "2026-10-15", resultFile: `${engineering.id}.json` });
    expect(made.issue).toMatchObject({ key: "night:2026-10-15", number: 1, date: "2026-10-15", items: 5, bookId: "h1", boxItemId: "box-1" });
    expect(w.library.get("h1")).toMatchObject({ fileName: "Daily Brief 2026-10-15 No. 1.epub", meta: { kind: "issue", publishedAt: "2026-10-15", filename: "Daily Brief No. 1 · Oct 15" } });
    // Only the GitHub original: the X post is not a document of its own.
    expect(w.attached).toEqual(["h1 https://github.com/acme/E1"]);
    expect(parseShelf(w.files.get(INFO_SHELF_FILE) ?? null).issues.map((i) => `${i.key} ${i.number} ${i.topics.map((t) => t.name).join("+")}`)).toEqual([
      "night:2026-10-15 1 AI for science+AI for engineering",
    ]);
    expect(w.box).toEqual([{ id: "box-1", boxId: "issue:night:2026-10-15", kind: ISSUE_BOX_KIND, cover: "Oct 15 brief · 5 items", body: "h1", origin: { place: "door", date: "2026-10-15" } }] as never);
    expect(issueBookOfItem(w.box[0])).toBe("h1");
    // Nothing more is due, and the same key again files nothing new.
    expect(await runClosed(w.deps, { searchId: science.searchId, kind: "daily", night: "2026-10-15", resultFile: null })).toEqual([]);
    await assembleIssue(w.deps, "night:2026-10-15", "2026-10-15", []);
    expect(w.library.size).toBe(1);
    expect(parseShelf(w.files.get(INFO_SHELF_FILE) ?? null).issues.length).toBe(1);
  });

  test("the reader's EPUB path reads the contents, every entry, the Notes and the Annex", async () => {
    const { bytes } = w.library.get("h1")!;
    if (process.env.ISSUE_SAMPLE) writeFileSync(process.env.ISSUE_SAMPLE, bytes);
    const book = parseEpub(bytes);
    expect(book.docs.length).toBe(5);
    expect(book.docs[0].text.text).toContain("Daily Brief No. 1");
    expect(book.docs[0].text.text).toContain("AI for science / Proteins: Conclusion of E1.");
    expect(book.docs[1].text.text).toContain("What happened with E1.");
    expect(book.docs[3].text.text).toContain("* * *");
    expect(book.docs[4].text.text).toContain("The field moved fast");
    const pagination = await paginate(book, characterRuler(700));
    const ft = fulltextFrom(book, pagination);
    expect(ft.status).toBe("ok");
    expect(ft.outline.map((o) => o.title)).toEqual(expect.arrayContaining(["Contents", "A tool for E1 at 90", "Notes", "Annex: AI for engineering"]));
  });

  test("an issue is numbered after the last one; a night with nothing new has none", async () => {
    const [made] = await assembleIssue(w.deps, "first:ts-0000bbbb", "2026-10-15", [`${nightResults()[1].id}.json`]).then((o) => [o]);
    expect(made.issue?.number).toBe(2);
    const empty = result("ts-0000aaaa", "AI for science", "2026-10-16", "daily", []);
    w.files.set("empty.json", JSON.stringify(empty));
    expect((await assembleIssue(w.deps, "night:2026-10-16", "2026-10-16", ["empty.json"])).issue).toBeNull();
  });
});

describe("a first look in two parts (topic-search/pace.ts)", () => {
  const first = () =>
    result("ts-0000aaaa", "AI for science", "2026-10-15", "first", [item("E1", 80), item("E2", 70)], { awaiting: ["x"] });

  test("the first part's issue says X is still being read and comes in an issue of its own", () => {
    const plan = planIssue([first()], TOPICS)!;
    expect(plan.awaiting).toEqual([{ searchId: "ts-0000aaaa", topic: "AI for science", sources: ["X"] }]);
    const contents = issueEpubInput(plan, { number: 3, date: "2026-10-15", locale: "en" }).sections[0].html;
    expect(contents).toContain("AI for science: X is still being read; what it finds comes in an issue of its own.");
    const zh = issueEpubInput(plan, { number: 3, date: "2026-10-15", locale: "zh-CN" }).sections[0].html;
    expect(zh).toContain("AI for science：X 还在读，读到的另出一期。");
    expect(planIssue([result("ts-0000aaaa", "AI for science", "2026-10-15", "first", [item("E1", 80)])], TOPICS)!.awaiting).toEqual([]);
  });

  test("the slow part merges like a retry and settles what the file awaits; each issue holds only its own part", () => {
    const slow = result("ts-0000aaaa", "AI for science", "2026-10-15", "first", [item("E3", 90)], { createdAt: 9 });
    const merged = mergeRetry(first(), slow, "r-first", true);
    expect(merged.awaiting).toBeUndefined();
    expect(merged.retries).toEqual([expect.objectContaining({ runId: "r-first", part: "slow", items: ["E3"] })]);
    expect(merged.items.map((i) => i.id)).toEqual(["E1", "E2", "E3"]);
    expect(firstPart(merged).items.map((i) => i.id)).toEqual(["E1", "E2"]);
    expect(retryPart(merged, "r-first")!.items.map((i) => i.id)).toEqual(["E3"]);
    // A retry leaves a file still awaiting X as it was.
    expect(mergeRetry(first(), slow, "r-retry").awaiting).toEqual(["x"]);
    // The slow part closes as what a retry adds, keyed by the first run's id.
    const state = noteClosed(emptyIssueState(), { searchId: "ts-0000aaaa", kind: "retry", night: null, resultFile: "f.json", runId: "r-first" });
    expect(dueIssues(state, [], 0, () => 0)).toEqual([{ key: "first:ts-0000aaaa#r-first", date: null, files: ["f.json"] }]);
  });
});

describe("a run whose candidates no model judged (topic-search 88 「判不了」)", () => {
  const unjudged = { runId: "r-first", at: 9, why: "Connection error.", candidates: 7 };

  test("its issue lists none of them and says the next run judges them, even with nothing else in it", () => {
    const waiting = result("ts-0000aaaa", "AI for science", "2026-10-15", "first", [], { empty: true, unjudged });
    const plan = planIssue([waiting], TOPICS)!;
    expect(plan.entries).toEqual([]);
    expect(plan.notes).toEqual([]);
    expect(plan.unjudged).toEqual([{ searchId: "ts-0000aaaa", topic: "AI for science", candidates: 7 }]);
    const contents = issueEpubInput(plan, { number: 3, date: "2026-10-15", locale: "en" }).sections[0].html;
    expect(contents).toContain(
      "AI for science: the step that judges what was found could not finish, so 7 candidates are not listed here; the topic's next run judges them.",
    );
    // Without it, an empty result still makes no issue.
    expect(planIssue([result("ts-0000aaaa", "AI for science", "2026-10-15", "first", [], { empty: true })], TOPICS)).toBeNull();
  });

  test("the slow part that went unjudged has an issue of its own; the first part's stays as it was", () => {
    const first = result("ts-0000aaaa", "AI for science", "2026-10-15", "first", [item("E1", 80)], { awaiting: ["x"] });
    const slow = result("ts-0000aaaa", "AI for science", "2026-10-15", "first", [], { empty: true, createdAt: 9, unjudged });
    const merged = mergeRetry(first, slow, "r-first", true);
    expect(merged.retries).toEqual([expect.objectContaining({ runId: "r-first", items: [], unjudged })]);
    expect(merged.unjudged).toBeUndefined();
    expect(firstPart(merged).unjudged).toBeUndefined();
    const part = retryPart(merged, "r-first")!;
    expect(part.items).toEqual([]);
    expect(planIssue([part], TOPICS)!.unjudged.map((u) => u.candidates)).toEqual([7]);
  });
});
