// The prep side of a reading turn's context (src/reading/prep/classroom.ts):
// which pages of a document are the document and which are its closing
// reference list, which prep notes ride along under the cap, and what the notes
// block and the prep list say. Pure. The prompt they are attached to is
// tests/context.test.ts's. Run: bun test.

import { expect, test } from "bun:test";
import { FULLTEXT_VERSION, type Fulltext } from "../../../../src/fulltext/types";
import { estimateTextTokens } from "../../../../src/budget";
import type { PrepChapter, PrepPaper, PrepState } from "../../../../src/reading/prep/papers/types";
import {
  classroomNoteBody,
  prepNotesSection,
  prepStatusSection,
  selectClassroomNotes,
  surveyBodyPageCount,
  CLASSROOM_NOTE_BUDGET,
  CLASSROOM_NOTE_BUDGET_TIGHT,
  type ClassroomNote,
} from "../../../../src/reading/prep/papers/classroom";

function ft(pages: string[]): Fulltext {
  return { version: FULLTEXT_VERSION, status: "ok", pages, outline: [] };
}

function paper(over: Partial<PrepPaper> = {}): PrepPaper {
  return {
    slug: "smith2023",
    title: "Smith 2023",
    authors: ["Smith"],
    year: 2023,
    arxivId: null,
    citedInChapters: [1],
    reason: "load-bearing",
    status: "done",
    ...over,
  };
}

function prep(papers: PrepPaper[], chapters: PrepChapter[] = []): PrepState {
  return {
    version: 1,
    surveyHash: "hash",
    surveyName: "survey.pdf",
    createdAt: 0,
    planStatus: "done",
    chapters,
    references: [],
    papers,
  };
}

// A note's [p.3] means page 3 of that paper. Inlined bare it lands in the
// survey's page namespace, and a citation copied out of it jumps to the wrong
// book. It is qualified on the way into the prompt, the same way read_note
// returns it.
test("an inlined note's page anchors name their own paper", () => {
  const notes = [
    {
      slug: "world-models",
      title: "World Models",
      body: "I have enough to write the note.\n\nA controller [p.4] and a range [p.6-7].",
    },
  ];
  const prompt = prepNotesSection(notes);
  expect(prompt).toContain("A controller [world-models p.4] and a range [world-models p.6-7].");
  // The writer's own aside does not go into the prompt.
  expect(prompt).not.toContain("I have enough to write the note.");
});

// --- the closing reference list ---

// The shape of the measured survey: body pages of running prose, then a page
// that ends the body and opens REFERENCES, then pages of numbered entries.
function bodyPage(n: number): string {
  return Array.from(
    { length: 40 },
    (_, i) => `Body prose on page ${n}, line ${i}, running on for a while as prose does.`,
  ).join("\n");
}

function referencePage(from: number): string {
  return Array.from(
    { length: 20 },
    (_, i) =>
      `[${from + i}] A. Author, B. Author, “A paper title of the usual length,” in\nProceedings of Something, 2023, pp. 1–10.`,
  ).join("\n");
}

const REF_BOOK = ft([
  bodyPage(1),
  bodyPage(2),
  `${bodyPage(3)}\nREFERENCES\n${referencePage(1)}`,
  referencePage(21),
  referencePage(41),
]);

const REF_CHAPTERS: PrepChapter[] = [
  { index: 1, title: "One", startPage: 1 },
  { index: 2, title: "Two", startPage: 3 },
];

test("the pages after the references heading are left out, the heading page kept", () => {
  expect(surveyBodyPageCount(REF_BOOK, REF_CHAPTERS)).toBe(3);
});

// Every way the test can fail lands on the same answer: keep the whole book.
// Cutting a bibliography saves tokens; cutting a chapter costs the class. Each
// case below trips exactly one rule.
const whole = (f: Fulltext, chapters: PrepChapter[] = REF_CHAPTERS) =>
  surveyBodyPageCount(f, chapters) === f.pages.length;

const ONE_CHAPTER: PrepChapter[] = [{ index: 1, title: "One", startPage: 1 }];

// Rule 1. Lazy prep opens the class before the plan lands (docs/09), and without
// the chapter table nothing says where the body ends. The measured failure: a
// real book's two classification-table pages sit after its reference pages, pass
// the density test on their own, and went out with them.
test("no chapter table means nothing is cut", () => {
  expect(whole(REF_BOOK, [])).toBe(true);
  expect(surveyBodyPageCount(REF_BOOK)).toBe(REF_BOOK.pages.length);
});

test("rule 2: no references heading anywhere, or nothing after it", () => {
  expect(whole(ft([bodyPage(1), bodyPage(2), referencePage(1), referencePage(21)]))).toBe(true);
  expect(whole(ft([bodyPage(1), bodyPage(2), `${bodyPage(3)}\nREFERENCES`]))).toBe(true);
});

test("rule 3: the plan puts a chapter after the heading page", () => {
  // So the heading is not the bibliography's — it is something inside the body.
  expect(whole(REF_BOOK, [...REF_CHAPTERS, { index: 3, title: "Three", startPage: 5 }])).toBe(true);
});

test("rule 4: the run of entry pages does not reach the last page", () => {
  // An appendix, an author-biography page, a table: the run stops short, so the
  // run was misread.
  const book = ft([
    bodyPage(1),
    `${bodyPage(2)}\nREFERENCES\n${referencePage(1)}`,
    referencePage(21),
    bodyPage(4),
  ]);
  expect(whole(book, ONE_CHAPTER)).toBe(true);
});

test("rule 4: a body page with a few wrapped citations is not an entry list", () => {
  // Five entry lines in a page of prose: 5 entries against a floor of 10, 559
  // characters per entry against a ceiling of 500, 0.111 of the lines against a
  // floor of 0.12. All three fail, and any one of them is enough.
  const wrapped = `${bodyPage(3)}\n[1] see also\n[2] and\n[3] and\n[4] and\n[5] and`;
  const book = ft([bodyPage(1), `${bodyPage(2)}\nREFERENCES\n${referencePage(1)}`, wrapped]);
  expect(whole(book, ONE_CHAPTER)).toBe(true);
});

// Rule 5, and the case that pays for it. Two pages of a real book's method
// comparison table pass all three density thresholds on their own — 13 entry
// lines, 39 characters each, 0.30 of the lines — because a bilingual table
// prints every citation twice. What they are not is a list that counts upward.
test("rule 5: entry numbers that repeat are a table quoting citations, not a list", () => {
  const tablePage = [
    "Category Method Year",
    "Visual SLAM CoSLAM [90] CoSLAM [90] 2012 2012",
    "SLAM++ [93] SLAM++ [93] 2013 2013",
    "[95]",
    "[95]",
    "[96] [96] 2020 2020",
    "[98] [98] 2021",
    "[98] [98] 2021",
    "[99] [99] 2022",
    "[99] [99] 2022",
    "[100] [100] 2023",
    "[100] [100] 2023",
    "[101] [101] 2024",
    "[101] [101] 2024",
  ].join("\n");
  const book = ft([
    bodyPage(1),
    `${bodyPage(2)}\nREFERENCES\n${referencePage(1)}`,
    referencePage(21),
    tablePage,
    tablePage,
  ]);
  expect(whole(book, ONE_CHAPTER)).toBe(true);
});

test("the extractor's small caps do not hide the heading", () => {
  const spaced = ft([
    bodyPage(1),
    `${bodyPage(2)}\nR EFERENCES\n${referencePage(1)}`,
    referencePage(21),
  ]);
  expect(surveyBodyPageCount(spaced, ONE_CHAPTER)).toBe(2);
});

// The other two headings the pattern accepts. The Chinese one is reached by a
// real 318-page book — its list opens on p.312 — which then keeps every page
// anyway, because its entries are numbered "1.Christian B." and match no entry
// marker. Both halves of that are pinned here.
test("参考文献 and BIBLIOGRAPHY are headings too", () => {
  const cn = ft([bodyPage(1), `${bodyPage(2)}\n参考文献\n${referencePage(1)}`, referencePage(21)]);
  expect(surveyBodyPageCount(cn, ONE_CHAPTER)).toBe(2);

  const biblio = ft([
    bodyPage(1),
    `${bodyPage(2)}\nBibliography\n${referencePage(1)}`,
    referencePage(21),
  ]);
  expect(surveyBodyPageCount(biblio, ONE_CHAPTER)).toBe(2);
});

test("a Chinese heading over unbracketed entries keeps every page", () => {
  const entries = Array.from(
    { length: 20 },
    (_, i) => `${i + 1}.Christian B. 《人机对齐》, 湛庐文化, 2023.`,
  ).join("\n");
  const cn = ft([bodyPage(1), `${bodyPage(2)}\n参考文献\n${entries}`, entries]);
  expect(whole(cn, ONE_CHAPTER)).toBe(true);
});

// --- which prep notes ride along ---

function note(slug: string, body: string): ClassroomNote {
  return { slug, title: slug, body };
}

test("every note rides along, in the order the queue would have prepped them", () => {
  const papers = [
    paper({ slug: "behind", citedInChapters: [1] }),
    paper({ slug: "here", citedInChapters: [4] }),
    paper({ slug: "ahead", citedInChapters: [5] }),
    paper({ slug: "pasted", citedInChapters: [], addedByUser: true }),
  ];
  const notes = papers.map((p) => note(p.slug, "body"));
  const picked = selectClassroomNotes(notes, papers, { chapter: 4, chapterCount: 6 });
  expect(picked.map((n) => n.slug)).toEqual(["pasted", "here", "ahead", "behind"]);
});

// The cap is the point of the ordering: which chapter the reader is scrolled to
// no longer decides whether a note comes at all, only who is dropped first.
test("the cap cuts from the far end of the queue, not at random", () => {
  const papers = [
    paper({ slug: "behind", citedInChapters: [1] }),
    paper({ slug: "here", citedInChapters: [4] }),
    paper({ slug: "ahead", citedInChapters: [5] }),
  ];
  const notes = papers.map((p) => note(p.slug, "x".repeat(4_000)));
  const one = estimateTextTokens(`${notes[0].slug}${notes[0].title}${notes[0].body}`);
  const picked = selectClassroomNotes(notes, papers, {
    chapter: 4,
    chapterCount: 6,
    budget: one * 2,
  });
  expect(picked.map((n) => n.slug)).toEqual(["here", "ahead"]);
});

// One pasted article's digest can be several times a paper's. Ending the list on
// it would cost every note behind it, so it is passed over instead.
test("a note too big for what is left is skipped, not the end of the list", () => {
  const papers = [
    paper({ slug: "huge", citedInChapters: [1] }),
    paper({ slug: "small", citedInChapters: [2] }),
  ];
  const notes = [note("huge", "x".repeat(40_000)), note("small", "x".repeat(400))];
  const picked = selectClassroomNotes(notes, papers, {
    chapter: 1,
    chapterCount: 3,
    budget: 1_000,
  });
  expect(picked.map((n) => n.slug)).toEqual(["small"]);
});

// The ladder's trim is a smaller budget, not a filter on the chapter number:
// the chapter comes from the reader's scroll position, and narrowing to it puts
// back the bug the cap was introduced to remove.
test("the tight budget gives up the same far end of the same queue, only sooner", () => {
  const papers = [
    paper({ slug: "here", citedInChapters: [2] }),
    paper({ slug: "ahead", citedInChapters: [5] }),
    paper({ slug: "pasted", citedInChapters: [], addedByUser: true }),
  ];
  const notes = papers.map((p) => note(p.slug, "x".repeat(4_000)));
  const full = selectClassroomNotes(notes, papers, { chapter: 2, chapterCount: 6 });
  const tight = selectClassroomNotes(notes, papers, {
    chapter: 2,
    chapterCount: 6,
    budget: CLASSROOM_NOTE_BUDGET_TIGHT,
  });
  expect(full.map((n) => n.slug)).toEqual(["pasted", "here", "ahead"]);
  // A prefix of the full list, never a differently-chosen set.
  expect(full.map((n) => n.slug).slice(0, tight.length)).toEqual(tight.map((n) => n.slug));
  expect(CLASSROOM_NOTE_BUDGET_TIGHT).toBe(CLASSROOM_NOTE_BUDGET / 4);
});

// The seam fix/citation-anchors lands its note cleaning in. Whatever it does,
// selectClassroomNotes must price the string the prompt prints, not the one on
// disk — applying the cleaning at print time instead costs 21% more tokens than
// the cap was told about.
test("the note body the prompt prints is the one that was priced", () => {
  const papers = [paper({ slug: "one", citedInChapters: [1] })];
  const notes = [note("one", classroomNoteBody("a body [p.3]", "one"))];
  const picked = selectClassroomNotes(notes, papers, { chapter: 1, chapterCount: 1 });
  expect(prepNotesSection(picked)).toContain(picked[0].body);
});

// --- the prep list ---

test("the prep list says which papers this turn is actually carrying", () => {
  const papers = [
    paper({ slug: "carried", title: "Carried" }),
    paper({ slug: "on-disk", title: "On Disk" }),
    paper({ slug: "thin", title: "Thin", status: "abstract-only" }),
  ];
  const prompt = prepStatusSection(prep(papers), new Set(["carried", "thin"]));
  expect(prompt).toContain("- carried — Carried (2023) [note below]");
  expect(prompt).toContain(
    '- on-disk — On Disk (2023) [note ready, not in this turn\'s context — read_note("on-disk")]',
  );
  // An abstract-only note that is in context says how thin it is.
  expect(prompt).toContain("- thin — Thin (2023) [note below — from the abstract only, no full text]");
});

// The model could not tell "all three sources were asked and it is not on any of
// them" from "the network dropped", and answered the reader either way.
test("a failed paper carries its reason, clipped", () => {
  const papers = [
    paper({ slug: "missing", status: "failed", error: "not found on arXiv, OpenAlex, or Semantic Scholar" }),
    paper({ slug: "offline", status: "failed", error: "Connection error." }),
    paper({ slug: "verbose", status: "failed", error: `TypeError: ${"x".repeat(400)}` }),
    paper({ slug: "silent", status: "failed" }),
    paper({ slug: "waiting", status: "queued" }),
  ];
  const prompt = prepStatusSection(prep(papers), new Set());
  expect(prompt).toContain("[no full text: not found on arXiv, OpenAlex, or Semantic Scholar]");
  expect(prompt).toContain("[no full text: Connection error.]");
  expect(prompt).toContain("[no full text: no reason recorded]");
  expect(prompt).toContain("[still being prepped]");
  // Clipped: a stack trace in a status line is the same failure as no reason.
  const verbose = prompt.split("\n").find((l) => l.startsWith("- verbose"))!;
  expect(verbose.length).toBeLessThan(140);
  expect(verbose).toContain("…");
});

test("the prep list is where the slugs come from, and it says so", () => {
  const prompt = prepStatusSection(prep([paper()]), new Set());
  expect(prompt).toContain("never");
  expect(prompt).toContain("make one up from a reference-list entry");
});

// --- the tools paragraph ---

// --- the teaching discipline (docs/09) ---

