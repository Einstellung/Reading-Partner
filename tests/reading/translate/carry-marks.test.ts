// Marks moving from an article to its translation, by their words.
// Run: bash scripts/t.sh tests/reading/translate/carry-marks.test.ts

import { expect, test } from "bun:test";
import {
  makeEpubSortIndex,
  newEpubMark,
  quoteSelectorAt,
  rangeAtSpan,
} from "../../../src/reading/epub/annotation";
import { buildArticleEpub } from "../../../src/reading/epub/file/build-article";
import { parseEpubRangeCfi, rangeToCfi, resolveRange } from "../../../src/reading/epub/file/cfi";
import { parseEpub, type SpineDocument } from "../../../src/reading/epub/file/parse";
import { carryMarks, type MarkRecord } from "../../../src/reading/translate/carry-marks";
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
