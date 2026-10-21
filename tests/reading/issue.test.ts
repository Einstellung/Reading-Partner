// A brief in the reader (src/reading/issue.ts, docs/info/88): which mode a
// document opens in, and the note the door's turn carries while one is open.

import { expect, test } from "bun:test";
import {
  CALL_HIGHLIGHT_MAX,
  HIGHLIGHT_MAX,
  issueCallPlace,
  issueContents,
  issueHighlights,
  issueTurnNote,
  pageOfQuote,
  readerModeOf,
} from "../../src/reading/issue";
import type { Annotation } from "../../src/platform/app/reader-contract";

test("an issue reads as a brief, everything else as a book", () => {
  expect(readerModeOf({ kind: "issue" })).toBe("issue");
  expect(readerModeOf({ kind: "book" })).toBe("book");
  expect(readerModeOf({ kind: "article" })).toBe("book");
  expect(readerModeOf({})).toBe("book");
  expect(readerModeOf(null)).toBe("book");
});

const mark = (id: string, page: number | null, text: string, extra: Record<string, unknown> = {}): Annotation =>
  ({
    id,
    type: "highlight",
    text,
    ...(page === null ? {} : { position: { pageIndex: page - 1 } }),
    ...extra,
  }) as Annotation;

test("the marks go in page order, page marks only, words squeezed and capped", () => {
  const marks = [
    mark("b", 5, "second   passage\n here"),
    mark("a", 2, "first passage"),
    mark("c", 3, ""),
    // A mark drawn on a reply is not a passage of the brief.
    mark("d", null, "a reply's words", { chatAnchor: { threadId: "t", messageTs: 1, text: "x", occurrence: 0 } }),
  ];
  expect(issueHighlights(marks)).toEqual([
    { page: 2, text: "first passage" },
    { page: 5, text: "second passage here" },
  ]);
  const many = Array.from({ length: HIGHLIGHT_MAX + 3 }, (_, i) => mark(`m${i}`, i + 1, `p${i}`));
  expect(issueHighlights(many)).toHaveLength(HIGHLIGHT_MAX);
  expect(issueHighlights([mark("long", 1, "x".repeat(400))])[0].text.length).toBe(200);
});

test("a quote is found on the page whose text holds it", () => {
  const text = { pages: ["Contents", "OpenAI shipped a model that writes proofs.", "Notes"] };
  expect(pageOfQuote(text, "shipped a model that writes proofs")).toBe(2);
  expect(pageOfQuote(text, "nowhere in the brief")).toBeNull();
  expect(pageOfQuote(null, "anything")).toBeNull();
  expect(pageOfQuote(text, "  ")).toBeNull();
});

test("the note says where the reader is, what they marked and where the quote is from", () => {
  const note = issueTurnNote({
    title: "Brief · Oct 15",
    page: 3,
    pageCount: 12,
    highlights: [{ page: 2, text: "first passage" }],
    quotes: true,
    quotePage: 4,
  });
  expect(note.startsWith("\n\n[App note, not the reader's words.")).toBe(true);
  expect(note).toContain('the brief "Brief · Oct 15" open, on page 3 of 12');
  expect(note).toContain('p.2 "first passage"');
  expect(note).toContain("quoted at the top of this message is on page 4");

  const bare = issueTurnNote({ title: "B", page: null, pageCount: null, highlights: [], quotes: false, quotePage: null });
  expect(bare).toContain('the brief "B" open.');
  expect(bare).toContain("They have marked nothing in it.");
  expect(bare).not.toContain("quoted");
});

// --- what a voice call's front is told (docs/info/88 「简报的对话」) ---------

const PAGES = {
  pages: [
    "Contents\nOpen weights for all\nChips get cheaper\nNotes",
    "Open weights for all\nThe lab released its weights.",
    "Chips get cheaper\nPrices fell again.",
    "Notes\nA small one: the conference moved online.",
  ],
};

test("the contents are the items' headings with the page each stands on", () => {
  expect(issueContents(PAGES, ["Open weights for all", "Chips get cheaper", "A small one", "Missing"])).toEqual([
    { heading: "Open weights for all", page: 2 },
    { heading: "Chips get cheaper", page: 3 },
    { heading: "A small one", page: 4 },
    { heading: "Missing", page: null },
  ]);
  // Text still being read out: the headings, no pages.
  expect(issueContents(null, ["Open weights for all"])).toEqual([{ heading: "Open weights for all", page: null }]);
});

test("the front is told which brief, where the reader is, what they marked and what is in it", () => {
  const place = issueCallPlace({
    title: "Brief No. 7",
    page: 3,
    pageCount: 4,
    highlights: [{ page: 3, text: "Prices fell again." }],
    contents: issueContents(PAGES, ["Open weights for all", "Chips get cheaper"]),
  });
  expect(place).toBe(
    [
      'They have the brief "Brief No. 7" open in the reader, on page 3 of 4.',
      "You have its headings, not its text: delegate anything about what an item says.",
      'They marked: p.3 "Prices fell again.".',
      "In it: p.2 Open weights for all; p.3 Chips get cheaper.",
    ].join("\n"),
  );
});

test("the front's place moves with the reader and stays short", () => {
  const base = { title: "B", pageCount: 9, highlights: [], contents: [] };
  expect(issueCallPlace({ ...base, page: 2 })).toContain("on page 2 of 9.");
  expect(issueCallPlace({ ...base, page: 7 })).toContain("on page 7 of 9.");
  const bare = issueCallPlace({ ...base, page: null, pageCount: null });
  expect(bare).toContain('the brief "B" open in the reader.');
  expect(bare).not.toContain("marked");
  expect(bare).not.toContain("In it");

  const long = "x".repeat(300);
  const many = Array.from({ length: 10 }, (_, i) => ({ page: i + 1, text: long }));
  const place = issueCallPlace({ ...base, page: 1, highlights: many, contents: [{ heading: long, page: 2 }] });
  const marked = place.split("\n").find((l) => l.startsWith("They marked"))!;
  expect(marked.split("; ")).toHaveLength(CALL_HIGHLIGHT_MAX);
  expect(marked.length).toBeLessThan(CALL_HIGHLIGHT_MAX * 95);
  expect(place.split("\n").find((l) => l.startsWith("In it"))!.length).toBeLessThan(80);
});
