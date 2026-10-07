// Marks and the reading position moving onto a successor by their words: an
// article onto its translation, a book onto a new version of itself.
// Run: bash scripts/t.sh tests/reading/replace/carry-marks.test.ts

import { expect, test } from "bun:test";
import {
  makeEpubSortIndex,
  newEpubMark,
  quoteSelectorAt,
  rangeAtSpan,
} from "../../../src/reading/epub/annotation";
import { buildArticleEpub } from "../../../src/workshop/bindery/build-article";
import {
  epubCfi,
  parseCfiStart,
  parseEpubRangeCfi,
  pointSteps,
  rangeToCfi,
  resolvePoint,
  resolveRange,
} from "../../../src/reading/epub/file/cfi";
import { runAt } from "../../../src/reading/epub/file/text";
import type { ViewState } from "../../../src/platform/app/reader-contract";
import { buildEpub } from "../epub/fixture";
import { parseEpub, type SpineDocument } from "../../../src/reading/epub/file/parse";
import {
  carryMarks,
  carryPosition,
  carryTargetsOf,
  type MarkRecord,
} from "../../../src/reading/replace/carry-marks";
import { translateArticleEpub } from "../../../src/reading/translate/translate-article";
import type { TranslateBatchFn } from "../../../src/reading/translate/prompt";

const INPUT = {
  title: "How a web page becomes a book",
  byline: "A Writer",
  sourceUrl: "https://example.com/posts/one",
  html: `<p>A zip file with a spine is a book once something can read it.</p>
    <h2 id="s">The first section</h2>
    <p>The pagination is measured against the tree, never against the source.</p>`,
  images: [],
};

const translator: TranslateBatchFn = async (request) => ({
  blocks: request.blocks.map((b) => ({ id: b.id, text: `[zh]${b.text}` })),
});

function markOver(spine: SpineDocument, phrase: string): MarkRecord {
  const start = spine.text.text.indexOf(phrase);
  expect(start).toBeGreaterThanOrEqual(0);
  const span = { start, end: start + phrase.length };
  const range = rangeAtSpan(spine.doc, spine.text, span);
  expect(range).not.toBeNull();
  const cfi = rangeToCfi(range as Range, spine.index, spine.idref);
  expect(cfi).not.toBeNull();
  return newEpubMark({
    id: "m1",
    stroke: "highlight",
    color: "#ffd400",
    cfi: cfi as string,
    spineIndex: spine.index,
    span,
    pageIndex: 3,
    pageLabel: "4",
    quote: quoteSelectorAt(spine.text.text, span),
    authorName: "A Reader",
    now: "2026-09-13T00:00:00Z",
  });
}

async function bilingual(): Promise<{ before: SpineDocument; after: SpineDocument }> {
  const original = await buildArticleEpub(INPUT);
  const out = await translateArticleEpub(original, {
    translateGlossary: async () => [],
    translateBatch: translator,
    limiter: { rampMs: 0 },
    timers: { now: () => 0, sleep: async () => {} },
  });
  return { before: parseEpub(original).docs[0], after: parseEpub(out.bytes).docs[0] };
}

test("a mark's words find their new place, and the new CFI resolves to them", async () => {
  const { before, after } = await bilingual();
  const phrase = "measured against the tree";
  const mark = markOver(before, phrase);
  const { moved, unmatched } = carryMarks([mark], {
    doc: after.doc,
    text: after.text,
    spineIndex: after.index,
    idref: after.idref,
  });
  expect(unmatched).toHaveLength(0);
  expect(moved).toHaveLength(1);

  const carried = moved[0];
  expect(carried.id).toBe("m1");
  expect(carried.type).toBe("highlight");
  expect(carried.authorName).toBe("A Reader");
  expect(carried.text).toBe(phrase);

  const offset = after.text.text.indexOf(phrase);
  expect(carried.sortIndex).toBe(makeEpubSortIndex(after.index, offset));
  // The offset really did move: the translation of the first paragraph is
  // between the start of the document and these words.
  expect(offset).toBeGreaterThan(before.text.text.indexOf(phrase));

  const parsed = parseEpubRangeCfi((carried.position as { value: string }).value);
  expect(parsed).not.toBeNull();
  const range = resolveRange(after.doc.documentElement, parsed!);
  expect(range?.toString()).toBe(phrase);
});

test("a quote whose spacing has drifted is still found", async () => {
  const { before, after } = await bilingual();
  const mark = markOver(before, "The first section");
  const loose = { ...mark, quote: { type: "TextQuoteSelector", exact: "the  FIRST   section", prefix: "", suffix: "" } };
  const { moved, unmatched } = carryMarks([loose], {
    doc: after.doc,
    text: after.text,
    spineIndex: after.index,
    idref: after.idref,
  });
  expect(unmatched).toHaveLength(0);
  expect(moved[0].text).toBe("The first section");
});

test("a mark whose words are gone, and one that never had any, are reported", async () => {
  const { before, after } = await bilingual();
  const gone = { ...markOver(before, "The first section"), quote: { type: "TextQuoteSelector", exact: "words this article never used", prefix: "", suffix: "" } };
  const bare = { ...markOver(before, "The first section") };
  delete bare.quote;
  const { moved, unmatched } = carryMarks([gone, bare], {
    doc: after.doc,
    text: after.text,
    spineIndex: after.index,
    idref: after.idref,
  });
  expect(moved).toHaveLength(0);
  expect(unmatched).toHaveLength(2);
  // Untouched: an unmatched mark is handed back exactly as it came.
  expect(unmatched[0]).toBe(gone);
});

// --- a book, onto a new version of itself --------------------------------------

const CHAPTER_ONE = "<h1>One</h1><p>The opening chapter says where the argument starts.</p>";
const CHAPTER_TWO =
  "<h1>Two</h1><p>A model that plumbs its own depths is a different animal.</p>" +
  "<p>The second paragraph is where the reader stopped reading last night.</p>";

// The same words laid out differently: a chapter file added in front, and every
// paragraph followed by its translation inside a wrapper.
function relaidOut(body: string): string {
  return body.replace(/<p>(.*?)<\/p>/g, '<div class="pair"><p>$1</p><p class="zh">[zh] $1</p></div>');
}

function books() {
  const v1 = parseEpub(
    buildEpub({ docs: [{ name: "c1.xhtml", body: CHAPTER_ONE }, { name: "c2.xhtml", body: CHAPTER_TWO }] }),
  );
  const v2 = parseEpub(
    buildEpub({
      docs: [
        { name: "preface.xhtml", body: "<h1>Preface</h1><p>Added in the second version.</p>" },
        { name: "c1.xhtml", body: relaidOut(CHAPTER_ONE) },
        { name: "c2.xhtml", body: relaidOut(CHAPTER_TWO) },
      ],
    }),
  );
  return { v1, v2 };
}

test("a book's mark is found in whichever chapter file the new version has it in", () => {
  const { v1, v2 } = books();
  const phrase = "plumbs its own depths";
  const { moved, unmatched } = carryMarks([markOver(v1.docs[1], phrase)], carryTargetsOf(v2));
  expect(unmatched).toHaveLength(0);
  const carried = moved[0];
  const parsed = parseEpubRangeCfi((carried.position as { value: string }).value);
  expect(parsed?.spineIndex).toBe(2);
  expect(resolveRange(v2.docs[2].doc.documentElement, parsed!)?.toString()).toBe(phrase);
  expect(carried.sortIndex).toBe(makeEpubSortIndex(2, v2.docs[2].text.text.indexOf(phrase)));
});

function pointCfiAt(spine: SpineDocument, phrase: string): string {
  const at = runAt(spine.text.runs, spine.text.text.indexOf(phrase));
  return epubCfi(spine.index, spine.idref, pointSteps(at!.node, at!.offset)!);
}

test("the reading position is moved onto the same words in the new version", () => {
  const { v1, v2 } = books();
  const phrase = "The second paragraph is where the reader stopped";
  const state: ViewState = { pageIndex: 4, scale: 1, scrollMode: 0, pageY: 120, cfi: pointCfiAt(v1.docs[1], phrase) };
  const carried = carryPosition(state, v1, carryTargetsOf(v2));
  expect(carried.pageIndex).toBe(4);
  expect(carried.pageY).toBe(120);
  const parsed = parseCfiStart(carried.cfi!);
  expect(parsed?.spineIndex).toBe(2);
  const at = resolvePoint(v2.docs[2].doc.documentElement, parsed!);
  expect((at?.node as Text).data.slice(at!.offset)).toStartWith(phrase);
});

test("a position on a running head whose heading was rewritten stays on that head in the same chapter file", () => {
  const head = "<p>Part one · The technical report</p>";
  const v1 = parseEpub(
    buildEpub({
      docs: [
        { name: "a.xhtml", body: `${head}<h2>First chapter / 第一章</h2><p>Words of the first chapter.</p>` },
        { name: "b.xhtml", body: `${head}<h2>Second chapter / 第二章</h2><p>Words of the second chapter.</p>` },
      ],
    }),
  );
  // The new layout puts each half of a bilingual heading on its own line.
  const v2 = parseEpub(
    buildEpub({
      docs: [
        { name: "a.xhtml", body: `${head}<h2>First chapter</h2><h2>第一章</h2><p>Words of the first chapter.</p>` },
        { name: "b.xhtml", body: `${head}<h2>Second chapter</h2><h2>第二章</h2><p>Words of the second chapter.</p>` },
      ],
    }),
  );
  const state: ViewState = { pageIndex: 7, scale: 1, scrollMode: 0, cfi: pointCfiAt(v1.docs[1], "Part one") };
  const parsed = parseCfiStart(carryPosition(state, v1, carryTargetsOf(v2)).cfi!);
  expect(parsed?.spineIndex).toBe(1);
  const at = resolvePoint(v2.docs[1].doc.documentElement, parsed!);
  expect((at?.node as Text).data.slice(at!.offset)).toStartWith("Part one");
});

test("a position whose words are gone from a chapter file the new version still has opens at the top of it", () => {
  const v1 = parseEpub(
    buildEpub({
      docs: [
        { name: "a.xhtml", body: "<p>The opening chapter, kept as it was.</p>" },
        { name: "b.xhtml", body: "<p>A paragraph the new version rewrote from the first word.</p>" },
      ],
    }),
  );
  const v2 = parseEpub(
    buildEpub({
      docs: [
        { name: "a.xhtml", body: "<p>The opening chapter, kept as it was.</p>" },
        { name: "b.xhtml", body: "<p>Entirely different sentences now stand in its place.</p>" },
      ],
    }),
  );
  const state: ViewState = { pageIndex: 9, scale: 1, scrollMode: 0, cfi: pointCfiAt(v1.docs[1], "A paragraph") };
  const parsed = parseCfiStart(carryPosition(state, v1, carryTargetsOf(v2)).cfi!);
  expect(parsed?.spineIndex).toBe(1);
  const at = resolvePoint(v2.docs[1].doc.documentElement, parsed!);
  expect((at?.node as Text).data.slice(at!.offset)).toStartWith("Entirely different");
});

test("a position whose words are gone keeps its page number and drops the old CFI", () => {
  const { v1 } = books();
  const other = parseEpub(buildEpub({ docs: [{ name: "x.xhtml", body: "<p>Nothing in common with the first book at all.</p>" }] }));
  const state: ViewState = { pageIndex: 4, scale: 1, scrollMode: 0, cfi: pointCfiAt(v1.docs[1], "The second paragraph") };
  expect(carryPosition(state, v1, carryTargetsOf(other))).toEqual({ pageIndex: 4, scale: 1, scrollMode: 0 });
  // A PDF's position has no CFI and is handed back untouched.
  const pdf: ViewState = { pageIndex: 2, scale: 1, scrollMode: 0 };
  expect(carryPosition(pdf, v1, carryTargetsOf(other))).toBe(pdf);
});
