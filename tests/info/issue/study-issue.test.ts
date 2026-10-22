// A study's brief as a book (docs/info/91 slice G): the plan of one version,
// the seven parts with their tappable cites, the front page and contents, the
// update block and tags of a later version, the cover, assembly of version 1
// and an update's version on one shelf row, no supplement cap, no expiry, and
// the reader's EPUB path over the result.

import { describe, expect, test } from "bun:test";
import { unzipSync, strFromU8 } from "fflate";
import { characterRuler, paginate } from "../../../src/reading/epub/paginate";
import { fulltextFrom } from "../../../src/reading/epub/fulltext";
import { parseEpub } from "../../../src/reading/epub/file/parse";
import { buildSectionedEpub } from "../../../src/workshop/bindery/build-article";
import { assembleIssue, dueIssues, emptyIssueState, markDone, noteClosed, parseStudyKey, runClosed, studyKey, type IssueDeps } from "../../../src/info/issue/assemble";
import { expiredIssues } from "../../../src/info/issue/expiry";
import type { IssueTopic } from "../../../src/info/issue/plan";
import { openingRecord } from "../../../src/info/issue/opening-record";
import { studyBookName, studyChangeLine, studyEpubInput } from "../../../src/info/issue/render-study";
import { anchorOfHref, citeAt, citeHref, citeLabel, citeOfId, itemAnchorId, itemOfAnchorId, splitAnchor } from "../../../src/info/issue/study-cites";
import { citeSheet, excerptFor, itemAtPage, landedAction, materialBodyPaths, sameItemIn, SETTLED_MS, studyBookContext, studyStrip, updatingTo, versionItems, versionRows } from "../../../src/info/issue/study-reader";
import { planStudyIssue, withStudyVersions } from "../../../src/info/issue/study-plan";
import { bookExcerpts, citedSections, excerptBody, excerptId, excerptInBook, pickExcerpt } from "../../../src/info/issue/study-excerpts";
import { INFO_SHELF_FILE, ISSUE_BOX_KIND, parseShelf, studyOfBook } from "../../../src/info/issue/types";
import type { RegisteredMaterial } from "../../../src/info/dossier/registry";
import { studyFileBody, studyFileName } from "../../../src/info/topic-search/study";
import { versionPart, type EntryParts, type EntrySentence, type StudyVersion, type TopicSearchResult, type TopicSearchResultItem } from "../../../src/info/topic-search/result-types";

const SEARCH = "ts-study01";
const NAME = "AI mechanism discovery";
const SCOPE = "How a system designs its own experiments on a black box and induces the rules.";
const DAY = 86_400_000;

const TOPIC: IssueTopic = {
  searchId: SEARCH,
  name: NAME,
  subtopics: [{ id: "s1", name: "Closed-loop science" }],
  study: { scope: SCOPE, sources: ["arxiv", "huggingface"], seeds: ["url:https://example.org/E1"] },
};

function paper(id: string, sections: [string, string | null][]): RegisteredMaterial {
  return {
    id,
    url: `https://arxiv.org/abs/${id}`,
    canonicalUrl: `https://arxiv.org/abs/${id}`,
    title: `Paper ${id}`,
    author: null,
    publishedAt: null,
    reader: "arxiv",
    facts: {},
    hash: id,
    sections: sections.map(([sid, heading]) => ({ id: sid, heading, chars: 100 })),
    body: `materials/${id}.json`,
  };
}

const say = (text: string, cites: string[] = [], quote?: string): EntrySentence => ({ text, cites, ...(quote ? { quote } : {}) });

function parts(over: Partial<EntryParts> = {}, read: EntryParts["confidence"]["read"] = { depth: "full", cut: false, through: null }): EntryParts {
  return {
    background: [say("Labs run experiments by hand.", ["M1.§1"])],
    prior: [say("AlphaZero learned by self-play.", ["M1"])],
    gap: [],
    method: [[say("The agent proposes an experiment.", ["M1.§2"]), say("A simulator runs it.", ["M1.§3"])], [say("It writes a rule.", ["M1.§4"])]],
    results: [say("It found 3 of 4 rules.", ["M1.§1"], "found three of four")],
    relevance: { helps: [say("A loop to copy.")], cannot: [say("No priors come in.")] },
    confidence: { read, admitted: [say("Only toy systems.", ["M1.§1"])], ours: [], dropped: [] },
    ...over,
  };
}

function item(id: string, key: string, over: Partial<TopicSearchResultItem> = {}): TopicSearchResultItem {
  return {
    id,
    key,
    keys: [],
    kind: "paper",
    subtopic: "s1",
    title: `Paper titled ${id}`,
    titleFrom: "original",
    summary: `What ${id} found.`,
    body: [],
    unknown: null,
    facts: { kind: "repo", fullName: `acme/${id}`, lookedUp: true, stars: 1, forks: 0, lastCommitAt: "2026-10-13", release: null, license: "MIT" },
    links: { original: `https://arxiv.org/abs/${id}`, posts: [] },
    materials: [],
    verify: { status: "read", reason: null, discrepancies: [], checked: { match: 0, mismatch: 0, absent: 0 } },
    continuing: null,
    score: 80,
    ...over,
  } as TopicSearchResultItem;
}

const KEY = (n: number) => `url:https://example.org/E${n}`;

function version(n: number, base: number | null, entries: StudyVersion["entries"], over: Partial<StudyVersion> = {}): StudyVersion {
  return { n, at: 1_000 + n, runId: `r${n}`, base, entries, removed: [], changes: [], lines: [], overview: { text: "The field: E1 leads, E2 follows.", cites: ["E1"] }, ...over };
}

/** A study file: version 1 from the first look, version 2 from an update. */
function studyResult(): TopicSearchResult {
  const v1 = version(1, null, [
    { item: "E1", place: "pinned", tag: null },
    { item: "E2", place: "main", tag: null },
    { item: "E3", place: "main", tag: null },
    { item: "E4", place: "note", tag: null },
  ]);
  const v2 = version(
    2,
    1,
    [
      { item: "E1", place: "pinned", tag: null },
      { item: "E5", place: "pinned", tag: "pinned" },
      { item: "E6", place: "main", tag: "rewritten" },
      { item: "E7", place: "main", tag: "new" },
      { item: "E3", place: "note", tag: "demoted" },
    ],
    {
      removed: [{ key: KEY(4), title: "Paper titled E4", line: "L1" }],
      changes: [
        { kind: "add", item: KEY(7), line: "L2" },
        { kind: "remove", item: KEY(4), line: "L1" },
        { kind: "demote", item: KEY(3), line: null },
        { kind: "rewrite", item: KEY(2), line: "L3" },
        { kind: "pin", item: KEY(5), line: "L4" },
      ],
      lines: ["L1", "L2", "L3", "L4"],
      skipped: ["q3"],
    },
  );
  const abstractOnly = parts(
    { results: [say("It beats the baseline.", ["M2.§1"])], gap: [], confidence: { read: { depth: "abstract", cut: false, through: null }, admitted: [], ours: [], dropped: [] } },
    { depth: "abstract", cut: false, through: null },
  );
  return {
    version: 1,
    id: `topic-search-${SEARCH}-2026-10-20`,
    searchId: SEARCH,
    name: NAME,
    kind: "first",
    date: "2026-10-20",
    createdAt: 1_001,
    window: { since: 0, until: 730 * DAY },
    empty: false,
    writeup: "model",
    overview: { text: "The field: E1 leads, E2 follows.", cites: ["E1"] },
    groups: [],
    quiet: [],
    items: [
      item("E1", KEY(1), { materials: ["M1"], parts: parts() }),
      item("E2", KEY(2), { materials: ["M2"], parts: abstractOnly }),
      item("E3", KEY(3), { materials: ["M3"] }),
      item("E4", KEY(4)),
      item("E5", KEY(5), { materials: ["M4"], parts: parts({}, { depth: "full", cut: true, through: "4 Experiments" }) }),
      item("E6", KEY(2), {
        materials: ["M2"],
        parts: parts({
          results: [],
          confidence: { read: { depth: "full", cut: false, through: null }, admitted: [], ours: [say("Same model judges.")], dropped: [{ part: "results", why: "number" }] },
        }),
      }),
      item("E7", KEY(7), { materials: ["M5"], parts: parts() }),
    ],
    materials: [
      paper("M1", [["M1.§1", "3.3 Results"], ["M1.§2", "PDF part 2"], ["M1.§3", "Method in which the agent picks its next experiment"], ["M1.§4", null]]),
      paper("M2", [["M2.§1", "Abstract"]]),
      paper("M3", []),
      paper("M4", []),
      paper("M5", []),
    ],
    questions: [],
    stats: { candidates: { x: 0, arxiv: 9 }, passedFloor: 0, pooled: 0, reranked: true, anchorMiss: 0, avoidBlocked: {}, subtopicItems: {}, modelCalls: 0 },
    runDir: "topic-search-runs/r",
    study: { versions: [v1, v2] },
  } as TopicSearchResult;
}

const SAID = { L1: "drop the survey", L2: "find one on <priors>", L3: "say who runs each step", L4: "pin the AlphaFold one" };

function planOf(n: number, said: Record<string, string> = SAID) {
  return planStudyIssue(versionPart(studyResult(), n)!, TOPIC, said)!;
}

describe("cites the reader can tap (study-cites.ts)", () => {
  test("anchors, hrefs and ids go both ways", () => {
    expect(citeHref("M3.§2")).toBe("#rp-cite-M3-2");
    expect(citeHref("M3")).toBe("#rp-cite-M3");
    expect(citeHref("E3")).toBeNull();
    expect(anchorOfHref("#rp-cite-M3-2")).toBe("M3.§2");
    expect(anchorOfHref("text/section-005.xhtml#rp-cite-M3")).toBe("M3");
    expect(anchorOfHref("section-002.xhtml")).toBeNull();
    expect(splitAnchor("M12.§10")).toEqual({ material: "M12", section: 10 });
    expect(itemOfAnchorId(itemAnchorId("E7"))).toBe("E7");
    expect(itemOfAnchorId("rp-cite-E7-1")).toBeNull();
  });

  test("a cite says the section's number, a PDF's part, a cut heading, or the original", () => {
    const pdf = (n: number) => `part ${n}`;
    expect(citeLabel("3.3 Results", 1, pdf, "original")).toBe("§3.3");
    expect(citeLabel("IV. Discussion", 4, pdf, "original")).toBe("§IV");
    expect(citeLabel("A.1 Proofs", 9, pdf, "original")).toBe("§A.1");
    expect(citeLabel("PDF part 2", 2, pdf, "original")).toBe("part 2");
    expect(citeLabel("Method in which the agent picks its next experiment", 3, pdf, "original")).toBe("Method in which the age…");
    expect(citeLabel(null, 4, pdf, "original")).toBe("§4");
    expect(citeLabel("Paper M1", null, pdf, "original")).toBe("original");
  });
});

describe("one version planned (study-plan.ts)", () => {
  test("pinned entries first, then main, then the notes; places and tags by item", () => {
    const plan = planOf(2);
    expect(plan.entries.map((p) => p.item.id)).toEqual(["E1", "E5", "E6", "E7"]);
    expect(plan.notes.map((p) => p.item.id)).toEqual(["E3"]);
    expect(plan.study!.pinned).toBe(2);
    expect(plan.study!.places.E6).toEqual({ place: "main", tag: "rewritten" });
    expect(plan.annex.map((a) => a.text)).toEqual(["The field: E1 leads, E2 follows."]);
    expect(plan.awaiting).toEqual([]);
  });

  test("a study file with no versions reads as version 1: seeds pinned, the rest placed the nightly way", () => {
    const old = { ...studyResult(), study: undefined };
    const v = withStudyVersions(old, [TOPIC], TOPIC.study!.seeds).study!.versions;
    expect(v.map((x) => [x.n, x.base])).toEqual([[1, null]]);
    expect(v[0].entries[0]).toEqual({ item: "E1", place: "pinned", tag: null });
    expect(v[0].entries.slice(1).every((e) => e.place !== "pinned")).toBe(true);
  });
});

describe("the book of version 1", () => {
  const input = studyEpubInput(planOf(1), { number: 4, date: "2026-10-20", locale: "en", companionName: "Lumen" });

  test("front page, contents, one page per entry, the Notes, the panorama; no update block", () => {
    expect(input.sections.map((s) => s.heading)).toEqual([NAME, "Contents", "Paper titled E1", "Paper titled E2", "Paper titled E3", "Notes", `Annex: ${NAME}`]);
    const front = input.sections[0].html;
    expect(front).toContain("Study · just this once");
    expect(front).toContain("Version 1 · Tuesday, October 20, 2026");
    expect(front).toContain(`This brief answers one question: ${SCOPE}`);
    expect(front).toContain("Sources: arXiv, Hugging Face, looking back 2 years. X was not read.");
    expect(front).toContain("Entries: 2 · Notes: 1 · Pinned: 1");
    expect(front).toContain("conversation with Lumen");
    const contents = input.sections[1].html;
    expect(contents.indexOf("<small>Pinned</small>")).toBeLessThan(contents.indexOf("Paper titled E2"));
    expect(contents).toContain('<a href="section-003.xhtml">Paper titled E1</a>');
    expect(input.title).toBe(`${NAME}, version 1, Tuesday, October 20, 2026`);
    expect(input.cover?.svg).toContain("Version 1");
    expect(studyBookName(NAME, 1, "en")).toBe(`${NAME} · version 1`);
  });

  test("an entry's seven parts, its cites as links with ids, its kicker", () => {
    const e1 = input.sections[2].html;
    expect(e1.startsWith('<div class="rp-study-item" id="rp-item-E1">')).toBe(true);
    expect(e1).toContain("<small>Pinned · your seed · Read in full</small>");
    for (const head of ["Background", "Earlier work", "What it lacked", "What this one did", "Results", "How it bears on your goal", "Helps with", "Cannot reach", "How sure", "The paper admits"]) {
      expect(e1).toContain(`<p><strong>${head}</strong></p>`);
    }
    expect(e1).not.toContain("<strong>We see</strong>");
    expect(e1).toContain('Labs run experiments by hand. <a class="rp-cite" id="rp-cite-E1-1" href="#rp-cite-M1-1">§3.3</a>');
    expect(e1).toContain('<a class="rp-cite" id="rp-cite-E1-2" href="#rp-cite-M1">original</a>');
    expect(e1).toContain('href="#rp-cite-M1-2">part 2</a>');
    expect(e1).toContain('href="#rp-cite-M1-3">Method in which the age…</a>');
    expect(e1).toContain('href="#rp-cite-M1-4">§4</a>');
    expect(e1).toContain("<q>found three of four</q>");
    // The story keeps its two paragraphs; the empty gap says what was read.
    expect(e1).toContain("A simulator runs it.");
    expect(e1).toContain("<p><small>Not in the part that was read.</small></p>");
    expect(e1).toContain("Read the whole paper.");
  });

  test("an abstract-only entry says so, and that the abstract gives no figures", () => {
    const e2 = input.sections[3].html;
    expect(e2).toContain("Abstract only");
    expect(e2).toContain("<p><small>Not in the abstract.</small></p>");
    expect(e2).toContain("<p><small>The abstract gives no figures.</small></p>");
    expect(e2).toContain("Read the abstract only.");
  });

  test("an item with no parts keeps its body; a note is a block of its own", () => {
    expect(input.sections[4].html).toContain('id="rp-item-E3"');
    expect(input.sections[5].html).toContain('<div class="rp-study-item" id="rp-item-E4">');
  });
});

describe("the book of version 2", () => {
  const input = studyEpubInput(planOf(2), { number: 4, date: "2026-10-21", locale: "en", companionName: "Lumen" });

  test("「This update」 first: groups, links, the removed struck, the reader's words, the skipped searches", () => {
    expect(input.sections.map((s) => s.heading)).toEqual(["This update", NAME, "Contents", "Paper titled E1", "Paper titled E5", "Paper titled E6", "Paper titled E7", "Notes", `Annex: ${NAME}`]);
    const update = input.sections[0].html;
    expect(update).toContain("from version 1");
    expect(update).toContain("<strong>Added 1 entry</strong>");
    expect(update).toContain('<a href="section-007.xhtml">Paper titled E7</a><br />Because you said: “find one on &lt;priors&gt;”');
    expect(update).toContain("<s>Paper titled E4</s><br />Because you said: “drop the survey”");
    expect(update).toContain('<a href="section-008.xhtml#rp-item-E3">Paper titled E3</a></li>');
    expect(update).toContain('<a href="section-006.xhtml">Paper titled E6</a>');
    expect(update).toContain("Newly pinned: 1 paper");
    expect(update).toContain("1 follow-up search did not run");
  });

  test("tags on the pages; a pin the reader made; a read cut short; results dropped for a number", () => {
    expect(input.sections[4].html).toContain("Pinned · you pinned it · Read in full · <strong>Newly pinned</strong>");
    expect(input.sections[4].html).toContain("Read the paper up to “4 Experiments”");
    const e6 = input.sections[5].html;
    expect(e6).toContain("<strong>Rewritten</strong>");
    expect(e6).toContain("The results' figures did not check out.");
    expect(e6).toContain("<p><strong>We see</strong></p>");
    expect(input.sections[6].html).toContain("<strong>New</strong>");
    expect(input.sections[7].html).toContain("<strong>Moved to the Notes</strong>");
    expect(input.sections[1].html).toContain("Entries: 2 · Notes: 1 · Pinned: 2");
    expect(studyChangeLine(planOf(2).study!.version, 5, "en")).toBe("1 added · 1 removed · 1 to the Notes · 1 rewritten · 1 pinned");
    expect(studyChangeLine(planOf(1).study!.version, 4, "en")).toBe("4 items");
  });

  test("in Chinese the labels are the program's", () => {
    const zh = studyEpubInput(planOf(2), { number: 4, date: "2026-10-21", locale: "zh-CN", companionName: "卢明" });
    expect(zh.sections[1].html).toContain("专题 · 只看这一次");
    expect(zh.sections[3].html).toContain("背景");
  });
});

function world(topics: IssueTopic[] = [TOPIC]) {
  const files = new Map<string, string>();
  const library = new Map<string, { fileName: string; meta: unknown; bytes: Uint8Array }>();
  const attached: string[] = [];
  const box: { id: string; boxId: string; cover: string; body: string }[] = [];
  let ids = 0;
  const deps: IssueDeps = {
    files: { read: async (p) => files.get(p) ?? null, write: async (p, t) => void files.set(p, t) },
    topics: async () => topics,
    activeSearchIds: async () => [],
    buildEpub: buildSectionedEpub,
    importBook: async (bytes, fileName, meta) => {
      const hash = `h${library.size + 1}`;
      library.set(hash, { fileName, meta, bytes });
      return { hash };
    },
    attachOriginal: async (bookId, m) => {
      attached.push(`${bookId} ${m.id}`);
      return true;
    },
    putBox: async (item) => void box.push(item),
    newBoxItemId: () => `box-${++ids}`,
    nightEndAt: () => Number.MAX_SAFE_INTEGER,
    now: () => 5,
    today: () => "2026-10-21",
  };
  return { files, library, attached, box, deps };
}

describe("a study's versions assembled onto one shelf row", () => {
  const w = world();
  const r = studyResult();
  const file = `${r.id}.json`;
  w.files.set(file, JSON.stringify({ ...r, study: { versions: [r.study!.versions[0]] } }));
  w.files.set(
    studyFileName(SEARCH),
    studyFileBody({
      version: 1,
      searchId: SEARCH,
      lines: Object.entries(SAID).map(([id, said]) => ({ id, kind: "judgment", text: said, said, evidence: "m1", item: null, state: "confirmed", at: 1, usedIn: 2 })),
      rollbacks: [],
    }),
  );

  test("the first look makes version 1 under first:<search>; every original attached", async () => {
    const [made] = await runClosed(w.deps, { searchId: SEARCH, kind: "first", night: null, resultFile: file });
    expect(made.issue).toMatchObject({ key: `first:${SEARCH}`, number: 1, bookId: "h1", items: 4, study: { current: 1 } });
    expect(made.issue!.study!.versions).toEqual([{ n: 1, bookId: "h1", at: 1_001, date: "2026-10-21", line: "4 items", items: 4, boxItemId: "box-1" }]);
    expect(w.library.get("h1")).toMatchObject({ fileName: `Study ${SEARCH} v1.epub`, meta: { kind: "issue", filename: `${NAME} · version 1` } });
    expect(w.attached).toEqual(["h1 M1", "h1 M2", "h1 M3"]);
    expect(w.box).toEqual([expect.objectContaining({ id: "box-1", boxId: `issue:first:${SEARCH}`, kind: ISSUE_BOX_KIND, cover: `${NAME} · version 1: 4 items`, body: "h1" })]);
  });

  test("an update's version 2 lands on the same row, number kept, the row pointing at it", async () => {
    w.files.set(file, JSON.stringify(r));
    const state = noteClosed(emptyIssueState(), { searchId: SEARCH, kind: "update", night: null, resultFile: file, version: 2 });
    expect(dueIssues(state, [], 0, () => 0)).toEqual([{ key: studyKey(SEARCH, 2), date: null, files: [file] }]);
    expect(markDone(state, studyKey(SEARCH, 2)).studies).toEqual({});
    expect(parseStudyKey(studyKey(SEARCH, 12))).toEqual({ searchId: SEARCH, n: 12 });
    expect(parseStudyKey(`first:${SEARCH}`)).toBeNull();
    const [made] = await runClosed(w.deps, { searchId: SEARCH, kind: "update", night: null, resultFile: file, version: 2 });
    const shelf = parseShelf(w.files.get(INFO_SHELF_FILE) ?? null);
    expect(shelf.issues.length).toBe(1);
    expect(made.issue).toMatchObject({ key: `first:${SEARCH}`, number: 1, bookId: "h2", items: 5, boxItemId: "box-1", study: { current: 2 } });
    expect(made.issue!.study!.versions.map((v) => [v.n, v.bookId, v.line])).toEqual([
      [1, "h1", "4 items"],
      [2, "h2", "1 added · 1 removed · 1 to the Notes · 1 rewritten · 1 pinned"],
    ]);
    expect(w.box[1]).toMatchObject({ id: "box-2", boxId: `issue:study:${SEARCH}:v2`, body: "h2" });
    expect(studyOfBook(shelf, "h1")?.version.n).toBe(1);
    expect(studyOfBook(shelf, "nope")).toBeNull();
  });

  test("the same version again files nothing new and puts its box item again", async () => {
    await assembleIssue(w.deps, studyKey(SEARCH, 2), "2026-10-22", [file]);
    expect(w.library.size).toBe(2);
    expect(w.box[w.box.length - 1]).toMatchObject({ id: "box-2", body: "h2" });
    await assembleIssue(w.deps, `first:${SEARCH}`, "2026-10-22", [file]);
    expect(w.library.size).toBe(2);
    expect(w.box[w.box.length - 1]).toMatchObject({ id: "box-1", body: "h1" });
  });

  test("study rows never expire; the other issues still do", () => {
    const shelf = parseShelf(w.files.get(INFO_SHELF_FILE) ?? null);
    const night = { ...shelf.issues[0], key: "night:2026-01-01", date: "2026-01-01", study: undefined };
    const old = { ...shelf, issues: [{ ...shelf.issues[0], date: "2026-01-01" }, night] };
    expect(expiredIssues(old, "2026-10-21").map((i) => i.key)).toEqual(["night:2026-01-01"]);
  });

  test("a label question on a pinned item says pinned, with the version", () => {
    const plan = planOf(2);
    const q = { id: "Q1", text: "", source: "metric" as const, resultId: r.id, template: { code: "label-item" as const, params: { item: KEY(5), title: "t", line: "", version: 1 } } };
    const record = openingRecord(plan, [q as never], null);
    expect(record.questions[0].template!.params).toMatchObject({ place: "pinned", version: 2 });
  });

  test("the reader's EPUB path keeps the cite links and item ids, and outlines every page", async () => {
    const bytes = w.library.get("h2")!.bytes;
    const zip = unzipSync(bytes);
    const xhtml = Object.entries(zip)
      .filter(([name]) => name.endsWith(".xhtml"))
      .map(([, data]) => strFromU8(data))
      .join("\n");
    expect(xhtml).toContain('id="rp-item-E1"');
    expect(xhtml).toMatch(/<a [^>]*class="rp-cite"[^>]*>/);
    expect(xhtml).toContain('href="#rp-cite-M1-1"');
    expect(xhtml).toContain('id="rp-cite-E1-1"');
    expect(xhtml).toContain("drop the survey");
    const book = parseEpub(bytes);
    expect(book.docs.length).toBe(9);
    const pagination = await paginate(book, characterRuler(700));
    const ft = fulltextFrom(book, pagination);
    expect(ft.status).toBe("ok");
    expect(ft.outline.map((o) => o.title)).toEqual(expect.arrayContaining(["This update", NAME, "Contents", "Paper titled E7", "Notes"]));
  });
});

test("a topic that is no study takes the old path; a study's first look filed before versions stands", async () => {
  const w = world([{ ...TOPIC, study: undefined }]);
  const r = { ...studyResult(), study: undefined };
  w.files.set("plain.json", JSON.stringify(r));
  const made = await assembleIssue(w.deps, `first:${SEARCH}`, "2026-10-21", ["plain.json"]);
  expect(made.issue?.study).toBeUndefined();
  expect(w.library.get("h1")!.fileName).toBe(`Daily Brief 2026-10-21 No. 1.epub`);
});

// --- slice H: the reader's side (study-reader.ts) ---------------------------------

describe("the reader's study chrome (study-reader.ts)", () => {
  test("every cite id on a page names the sentence and anchor citeAt finds", () => {
    const result = studyResult();
    const input = studyEpubInput(planOf(2), { number: 4, date: "2026-10-21", locale: "en", companionName: "Lumen" });
    const html = input.sections.map((s) => s.html).join("\n");
    const links = [...html.matchAll(/<a class="rp-cite" id="(rp-cite-E\d+-\d+)" href="([^"]+)">/g)];
    expect(links.length).toBeGreaterThan(5);
    for (const [, id, href] of links) {
      const place = citeOfId(id)!;
      const item = result.items.find((i) => i.id === place.item)!;
      expect(citeAt(item.parts!, place.n)?.anchor).toBe(anchorOfHref(href)!);
    }
    expect(citeOfId("rp-item-E7")).toBeNull();
  });

  test("the sheet: the tapped sentence as the gist, its quote, and the section's paragraphs when the body is here", () => {
    const result = studyResult();
    // E1's cites: background M1.§1 (1), prior M1 (2), method M1.§2 (3), M1.§3 (4), M1.§4 (5), results M1.§1 (6).
    const tap = { href: "text/section-003.xhtml#rp-cite-M1-1", id: "rp-cite-E1-6", text: "§3.3" };
    const bare = citeSheet(result, tap, null)!;
    expect(bare).toMatchObject({ anchor: "M1.§1", label: "§3.3", heading: "3.3 Results", gist: "It found 3 of 4 rules.", quote: "found three of four", excerpt: [], part: "results" });
    const body = {
      id: "M1",
      url: "https://arxiv.org/abs/M1",
      sections: [{ id: "M1.§1", heading: "3.3 Results", text: "We ran four systems.\n\nThe agent found three of four rules.\n\nOurs 3 4 75.0\n\nPySR 1 4 25.0" }],
    };
    const full = citeSheet(result, tap, body)!;
    expect(full.excerptBy).toBe("quote");
    expect(full.excerpt).toEqual(["The agent found three of four rules."]);
    // No quote: the rows holding the sentence's figures.
    expect(excerptFor(body.sections[0].text, { text: "75% against 25%", quote: undefined })).toEqual({ paras: ["Ours 3 4 75.0", "PySR 1 4 25.0"], by: "figures" });
    expect(excerptFor("Opening words.\n\nMore.", { text: "Nothing to match." }).by).toBe("opening");
    // A link that is no cite is not taken.
    expect(citeSheet(result, { href: "#rp-item-E1", id: null, text: "" }, null)).toBeNull();
  });

  test("the same item in another version is the one with its key; the item the reader is on is the last one before the page", () => {
    const result = studyResult();
    expect(sameItemIn(result, "E2", 2)?.id).toBe("E6");
    expect(sameItemIn(result, "E4", 2)).toBeNull();
    const items = versionItems(result, 1);
    expect(items.map((i) => i.id)).toEqual(["E1", "E2", "E3", "E4"]);
    const pages: Record<string, number> = { "Paper titled E1": 3, "Paper titled E2": 4, "Paper titled E3": 5, "Paper titled E4": 6 };
    const pageOf = (title: string) => pages[title] ?? null;
    expect(itemAtPage(items, pageOf, 2)).toBeNull();
    expect(itemAtPage(items, pageOf, 4)?.id).toBe("E2");
    expect(itemAtPage(items, pageOf, 9)?.id).toBe("E4");
  });

  test("versions, the current one after a return, and the list's actions", () => {
    const shelf = parseShelf(
      JSON.stringify({
        version: 1,
        issues: [
          {
            key: `first:${SEARCH}`, number: 4, date: "2026-10-21", topics: [{ searchId: SEARCH, name: NAME }], results: ["r"], items: 5,
            bookId: "b2", boxItemId: "x", createdAt: 1,
            study: { current: 2, versions: [
              { n: 1, bookId: "b1", at: 100, date: "2026-10-21", line: "first", items: 4, boxItemId: "x1" },
              { n: 2, bookId: "b2", at: 200, date: "2026-10-21", line: "2 added", items: 5, boxItemId: "x2" },
            ] },
          },
        ],
        volumes: [],
      }),
    );
    const ctx = studyBookContext(shelf, "b1", [])!;
    expect(ctx).toMatchObject({ searchId: SEARCH, current: 2, newest: 2 });
    expect(ctx.viewing.n).toBe(1);
    expect(versionRows(ctx).map((r) => [r.n, r.current, r.viewing, r.canOpen, r.canRollBack])).toEqual([
      [2, true, false, true, false],
      [1, false, true, false, true],
    ]);
    expect(studyBookContext(shelf, "b2", [{ to: 1, at: 300 }])!.current).toBe(1);
    expect(studyBookContext(shelf, "other", [])).toBeNull();
  });

  test("the strip, the update in flight and what a landing version does", () => {
    expect(studyStrip({ viewing: 1, current: 2, updating: 3, landed: null })).toEqual({ kind: "old", viewing: 1, current: 2 });
    expect(studyStrip({ viewing: 2, current: 2, updating: 3, landed: null })).toEqual({ kind: "updating", to: 3, viewing: 2 });
    expect(studyStrip({ viewing: 2, current: 3, updating: null, landed: 3 })).toEqual({ kind: "landed", n: 3 });
    expect(studyStrip({ viewing: 2, current: 2, updating: null, landed: null })).toBeNull();
    const runs = [
      { idempotencyKey: `topic-search:${SEARCH}:update:7`, state: "running" },
      { idempotencyKey: `topic-search:${SEARCH}:update:2`, state: "done" },
      { idempotencyKey: `topic-search:other:update:5`, state: "pending" },
      { idempotencyKey: `topic-search:${SEARCH}:first`, state: "running" },
    ];
    expect(updatingTo(runs, SEARCH, 2)).toBe(3);
    expect(updatingTo(runs.slice(1), SEARCH, 2)).toBeNull();
    expect(landedAction({ wasCurrent: false, hidden: false, lastMovedAt: 0, now: 1e6 })).toBe("none");
    expect(landedAction({ wasCurrent: true, hidden: false, lastMovedAt: 1e6 - 5_000, now: 1e6 })).toBe("chip");
    expect(landedAction({ wasCurrent: true, hidden: false, lastMovedAt: 1e6 - SETTLED_MS, now: 1e6 })).toBe("switch");
    expect(landedAction({ wasCurrent: true, hidden: true, lastMovedAt: 1e6, now: 1e6 })).toBe("switch");
  });

  test("a material's body is looked for in the first run's directory, then in each later run's", () => {
    const result = { runDir: "topic-search-runs/r1", retries: [{ runId: "r2", at: 1, added: 0 } as never] };
    expect(materialBodyPaths(result, "M3")).toEqual(["topic-search-runs/r1/materials/M3.json", "topic-search-runs/r2/materials/M3.json"]);
  });
});

// --- the cited sections' text in the book (study-excerpts.ts) -----------------------

describe("the cited sections' text carried in the book (study-excerpts.ts)", () => {
  const M1 = {
    id: "M1",
    url: "https://arxiv.org/abs/M1",
    sections: [
      { id: "M1.§1", heading: "3.3 Results", text: "We ran four systems.\n\nThe agent found three of four rules.\n\nOurs 3 4 75.0" },
      { id: "M1.§2", heading: "PDF part 2", text: "Part two <of> the paper." },
      { id: "M1.§3", heading: "Method", text: "The agent picks its next experiment." },
      { id: "M1.§4", heading: null, text: "It writes a rule." },
    ],
  };

  test("the sections a book cites, in the order it first cites them, each with the sentences citing it", () => {
    const cited = citedSections(planOf(1).entries.map((p) => p.item));
    expect(cited.map((c) => c.anchor)).toEqual(["M1.§1", "M1", "M1.§2", "M1.§3", "M1.§4", "M2.§1"]);
    expect(cited[0].sentences.slice(0, 3).map((x) => x.text)).toEqual(["Labs run experiments by hand.", "It found 3 of 4 rules.", "Only toy systems."]);
    expect(excerptId("M1.§2")).toBe("rp-excerpt-M1-2");
    expect(excerptId("M1")).toBe("rp-excerpt-M1");
    expect(excerptId("E1")).toBeNull();
  });

  test("a section keeps the paragraphs its sentences point at first, then its opening, within the cap", () => {
    const opening = "Opening words here. ".repeat(6).trim();
    const text = [opening, "Middle 42 rows.", "The agent found three of four rules.", "Tail."].join("\n\n");
    const quoted = [{ text: "x", quote: "found three of four" }];
    expect(pickExcerpt(text, quoted, 400)).toEqual({ paras: [opening, "Middle 42 rows.", "The agent found three of four rules.", "Tail."], cut: false });
    expect(pickExcerpt(text, quoted, 100)).toEqual({ paras: ["The agent found three of four rules."], cut: true });
    expect(pickExcerpt(text, [{ text: "It saw 42 of them." }], 60)).toEqual({ paras: ["Middle 42 rows."], cut: true });
    const long = pickExcerpt("A".repeat(500), [], 300)!;
    expect(long.cut).toBe(true);
    expect(long.paras[0].length).toBe(300);
    expect(long.paras[0].endsWith("…")).toBe(true);
    expect(pickExcerpt("  \n\n ", [], 300)).toBeNull();
  });

  test("a book carries sections up to its cap and counts the ones left out; a section with no text here is skipped", () => {
    const cited = [
      { anchor: "M1.§1", sentences: [] },
      { anchor: "M9.§1", sentences: [] },
      { anchor: "M1.§2", sentences: [] },
      { anchor: "M1.§3", sentences: [] },
    ];
    const text = (a: string) => (a.startsWith("M9") ? null : a === "M1.§3" ? "Short." : "x".repeat(100));
    const out = bookExcerpts(cited, text, { section: 2_000, book: 150 });
    expect(out.excerpts.map((e) => e.anchor)).toEqual(["M1.§1", "M1.§3"]);
    expect(out.left).toBe(1);
  });

  test("the excerpts close the book; without any the book is as before", () => {
    const meta = { number: 4, date: "2026-10-21", locale: "en" as const, companionName: "Lumen" };
    const plain = studyEpubInput(planOf(1), meta);
    expect(studyEpubInput(planOf(1), meta, { excerpts: [], left: 0 })).toEqual(plain);
    const input = studyEpubInput(planOf(1), meta, {
      excerpts: [
        { anchor: "M1.§1", paras: ["The agent found three of four rules."], cut: false },
        { anchor: "M1.§2", paras: ["Part two <of> the paper."], cut: true },
      ],
      left: 2,
    });
    expect(input.sections.length).toBe(plain.sections.length + 1);
    const last = input.sections[input.sections.length - 1];
    expect(last.heading).toBe("Cited passages");
    expect(last.html).toContain('<div class="rp-excerpt" id="rp-excerpt-M1-1">');
    expect(last.html).toContain("<p><strong>Paper M1</strong> · 3.3 Results</p>");
    expect(last.html).toContain("· part 2</p>");
    expect(last.html).toContain('<p class="rp-excerpt-text">Part two &lt;of&gt; the paper.</p>');
    expect(last.html).toContain("Cut here; the rest of the section is in the original.");
    expect(last.html).toContain("2 more cited sections did not fit in this book");
    expect(last.html).toContain("up to about 2000 characters a section");
  });

  test("assembled where the run's bodies are, the book carries them and the sheet reads them from the book", async () => {
    const w = world();
    const r = studyResult();
    const file = `${r.id}.json`;
    w.files.set(file, JSON.stringify({ ...r, study: { versions: [r.study!.versions[0]] } }));
    w.files.set("topic-search-runs/r/materials/M1.json", JSON.stringify(M1));
    w.files.set("topic-search-runs/r/materials/M2.json", "{torn");
    await runClosed(w.deps, { searchId: SEARCH, kind: "first", night: null, resultFile: file });
    const book = parseEpub(w.library.get("h1")!.bytes);
    expect(excerptInBook(book.docs, "M1.§1")).toEqual(["We ran four systems.", "The agent found three of four rules.", "Ours 3 4 75.0"]);
    expect(excerptInBook(book.docs, "M1.§2")).toEqual(["Part two <of> the paper."]);
    expect(excerptInBook(book.docs, "M1")).not.toBeNull();
    expect(excerptInBook(book.docs, "M2.§1")).toBeNull();
    const tap = { href: "text/section-003.xhtml#rp-cite-M1-1", id: "rp-cite-E1-6", text: "§3.3" };
    const sheet = citeSheet(r, tap, excerptBody("M1.§1", excerptInBook(book.docs, "M1.§1")!))!;
    expect(sheet).toMatchObject({ excerpt: ["The agent found three of four rules."], excerptBy: "quote", heading: "3.3 Results" });
    const pagination = await paginate(book, characterRuler(700));
    expect(fulltextFrom(book, pagination).outline.map((o) => o.title)).toContain("Cited passages");
  });
});
