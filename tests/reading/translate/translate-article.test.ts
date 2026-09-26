// An article EPUB in, a bilingual EPUB out, through the whole core with a fake
// model. Run: bash scripts/t.sh tests/reading/translate/translate-article.test.ts

import { expect, test } from "bun:test";
import { buildArticleEpub } from "../../../src/reading/epub/file/build-article";
import { parseEpub } from "../../../src/reading/epub/file/parse";
import { openZip } from "../../../src/reading/epub/file/zip";
import { characterRuler, paginate } from "../../../src/reading/epub/paginate";
import { segmentDocument } from "../../../src/reading/translate/segment";
import {
  translateArticleEpub,
  TranslateError,
} from "../../../src/reading/translate/translate-article";
import {
  BatchShapeError,
  type GlossaryFn,
  type GlossaryRequest,
  type TranslateBatchFn,
  type TranslateBatchRequest,
} from "../../../src/reading/translate/prompt";
import { PNG } from "../epub/fixture";

const PROSE = "the quick brown fox jumps over the lazy dog. ".repeat(6);

const BODY = `<div id="readability-page-1">
  <p>${PROSE}</p>
  <h2 id="first-section">The first section</h2>
  <p>Call <code>parse()</code> before anything else. ${PROSE}</p>
  <ul><li>First item</li><li>Second item</li></ul>
  <pre><code>const x = 1;\nconst y = 2;</code></pre>
  <table><tr><td>A cell of text</td></tr></table>
  <figure><img src="https://cdn.example.com/a.png" alt="a diagram"/><figcaption>Figure 1</figcaption></figure>
  <h3>A sub-heading</h3>
  <p>${PROSE}</p>
</div>`;

const INPUT = {
  title: "How a web page becomes a book",
  byline: "A Writer",
  sourceUrl: "https://example.com/posts/how-a-web-page-becomes-a-book",
  publishedAt: "2026-09-12T08:30:00Z",
  html: BODY,
  images: [{ src: "https://cdn.example.com/a.png", bytes: PNG, mediaType: "image/png" }],
};

// A translator that answers every block, so the output can be told apart from
// the original character by character.
function fakeTranslator(seen: TranslateBatchRequest[] = []): TranslateBatchFn {
  return async (request) => {
    seen.push(request);
    return { blocks: request.blocks.map((b) => ({ id: b.id, text: `[zh]${b.text}` })) };
  };
}

// The glossary pass, answering with one term.
function fakeGlossary(seen: GlossaryRequest[] = []): GlossaryFn {
  return async (request) => {
    seen.push(request);
    return [{ source: "fox", zh: "狐狸" }];
  };
}

// No stagger and no real clock: the pacing is the limiter's own test's subject,
// and a three-second ramp per call would make this file take a minute.
const PACING = { limiter: { rampMs: 0 }, timers: { now: () => 0, sleep: async () => {} } };

function deps(over: Partial<Parameters<typeof translateArticleEpub>[1]> = {}) {
  return {
    translateGlossary: fakeGlossary(),
    translateBatch: fakeTranslator(),
    ...PACING,
    ...over,
  };
}

function entry(bytes: Uint8Array, name: string): Uint8Array {
  const found = openZip(bytes).bytes(name);
  expect(found).not.toBeNull();
  return found as Uint8Array;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function translated(): Promise<{ original: Uint8Array; bilingual: Uint8Array }> {
  const original = await buildArticleEpub(INPUT);
  const out = await translateArticleEpub(original, deps());
  return { original, bilingual: out.bytes };
}

test("the result is an EPUB the reader opens and paginates", async () => {
  const { bilingual } = await translated();
  const book = parseEpub(bilingual);
  expect(book.docs).toHaveLength(1);
  expect(book.docs[0].entry).toBe("text/article.xhtml");
  expect(book.pkg.title).toBe(INPUT.title);
  const pagination = await paginate(book, characterRuler(900));
  expect(pagination.blocks.length).toBeGreaterThanOrEqual(1);
});

test("every translatable block gained one sibling, and nothing else did", async () => {
  const original = await buildArticleEpub(INPUT);
  const before = segmentDocument(parseEpub(original).docs[0].doc).length;
  const out = await translateArticleEpub(original, deps());
  expect(out.blocks).toBe(before);

  const doc = parseEpub(out.bytes).docs[0].doc;
  const zh = Array.from(doc.querySelectorAll(".rp-zh"));
  expect(zh).toHaveLength(before);
  expect(zh.every((el) => el.getAttribute("lang") === "zh")).toBe(true);
  expect(zh.every((el) => (el.textContent ?? "").startsWith("[zh]"))).toBe(true);
  // Segmenting the output again finds the originals and none of the translations.
  expect(segmentDocument(doc).length).toBe(before);
});

test("the code, the table and the figure come through untouched", async () => {
  const { original, bilingual } = await translated();
  const before = new TextDecoder().decode(entry(original, "text/article.xhtml"));
  const after = new TextDecoder().decode(entry(bilingual, "text/article.xhtml"));
  for (const fragment of [
    "<pre><code>const x = 1;\nconst y = 2;</code></pre>",
    "<td>A cell of text</td>",
    "<figcaption>Figure 1</figcaption>",
  ]) {
    expect(before).toContain(fragment);
    expect(after).toContain(fragment);
  }
});

test("the outline, the pictures and the header are the article's own", async () => {
  const { original, bilingual } = await translated();
  expect(sameBytes(entry(original, "nav.xhtml"), entry(bilingual, "nav.xhtml"))).toBe(true);

  const images = openZip(original).entries.filter((e) => e.name.startsWith("images/"));
  expect(images.length).toBeGreaterThan(0);
  for (const image of images) {
    expect(sameBytes(entry(original, image.name), entry(bilingual, image.name))).toBe(true);
  }

  const text = parseEpub(bilingual).docs[0].text.text;
  expect(text).toContain(INPUT.title);
  expect(text).toContain("A Writer");
  expect(text).toContain(INPUT.sourceUrl);
  // The source line and the byline are metadata, not prose: no translation.
  const doc = parseEpub(bilingual).docs[0].doc;
  expect(doc.querySelector(".rp-source + .rp-zh")).toBeNull();
});

test("one glossary is settled first and every batch is handed the same one", async () => {
  const asked: GlossaryRequest[] = [];
  const seen: TranslateBatchRequest[] = [];
  const original = await buildArticleEpub(INPUT);
  const steps: Array<[number, number]> = [];
  const out = await translateArticleEpub(
    original,
    deps({
      translateGlossary: fakeGlossary(asked),
      translateBatch: fakeTranslator(seen),
      onProgress: (done, total) => steps.push([done, total]),
      // Small enough that this short article takes several calls.
      limits: { target: 30, max: 60 },
    }),
  );
  expect(asked).toHaveLength(1);
  expect(asked[0].title).toBe(INPUT.title);
  expect(asked[0].headings).toContain("The first section");

  expect(seen.length).toBeGreaterThan(1);
  const glossary = [{ source: "fox", zh: "狐狸" }];
  expect(seen.every((r) => r.title === INPUT.title)).toBe(true);
  for (const request of seen) expect(request.glossary).toEqual(glossary);
  expect(out.glossary).toEqual(glossary);
  expect(steps).toHaveLength(seen.length);
  expect(steps[steps.length - 1][0]).toBe(steps[steps.length - 1][1]);
});

test("batches run together under the ceiling and land in document order", async () => {
  const original = await buildArticleEpub(INPUT);
  let live = 0;
  let peak = 0;
  let started = 0;
  // Later batches answer first, so completion order is the reverse of the
  // document's and the writing back has to be the one that puts it right.
  const reversed: TranslateBatchFn = async (request) => {
    const mine = started++;
    live++;
    peak = Math.max(peak, live);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 20 - mine * 4)));
    live--;
    return { blocks: request.blocks.map((b) => ({ id: b.id, text: `[zh#${b.id}]` })) };
  };
  const out = await translateArticleEpub(
    original,
    deps({ translateBatch: reversed, limits: { target: 20, max: 40 }, concurrency: 3 }),
  );
  expect(started).toBeGreaterThan(3);
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(3);

  const doc = parseEpub(out.bytes).docs[0].doc;
  const order = segmentDocument(doc).map((b) => `[zh#${b.id}]`);
  expect(Array.from(doc.querySelectorAll(".rp-zh")).map((el) => el.textContent)).toEqual(order);
});

test("translating the translation is refused", async () => {
  const { bilingual } = await translated();
  await expect(translateArticleEpub(bilingual, deps())).rejects.toThrow(TranslateError);
});

test("a batch that comes back mis-shaped is retried once, then fails the run", async () => {
  const original = await buildArticleEpub(INPUT);
  let calls = 0;
  const flaky: TranslateBatchFn = async (request) => {
    calls++;
    if (calls === 1) throw new BatchShapeError("short");
    return { blocks: request.blocks.map((b) => ({ id: b.id, text: "译" })) };
  };
  const out = await translateArticleEpub(original, deps({ translateBatch: flaky }));
  expect(calls).toBe(2);
  expect(out.blocks).toBeGreaterThan(0);

  let always = 0;
  const broken: TranslateBatchFn = async () => {
    always++;
    throw new BatchShapeError("short");
  };
  await expect(translateArticleEpub(original, deps({ translateBatch: broken }))).rejects.toThrow(
    TranslateError,
  );
  expect(always).toBe(2);
});

test("one batch failing abandons the rest, and no half-translated book comes back", async () => {
  const original = await buildArticleEpub(INPUT);
  let calls = 0;
  const doomed: TranslateBatchFn = async (request) => {
    calls++;
    if (calls === 1) throw new Error("the provider refused");
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { blocks: request.blocks.map((b) => ({ id: b.id, text: "译" })) };
  };
  await expect(
    translateArticleEpub(
      original,
      deps({ translateBatch: doomed, limits: { target: 20, max: 40 }, concurrency: 2 }),
    ),
  ).rejects.toThrow(TranslateError);
  // A failure that is not the provider pushing back is not retried, and the
  // batches still queued behind the ceiling never start.
  expect(calls).toBeLessThan(4);
});

test("a glossary that cannot be settled fails the run before a block is sent", async () => {
  const original = await buildArticleEpub(INPUT);
  let translated = 0;
  const counted: TranslateBatchFn = async (request) => {
    translated++;
    return { blocks: request.blocks.map((b) => ({ id: b.id, text: "译" })) };
  };
  const refused: GlossaryFn = async () => {
    throw new BatchShapeError("no terms array");
  };
  await expect(
    translateArticleEpub(original, deps({ translateGlossary: refused, translateBatch: counted })),
  ).rejects.toThrow(TranslateError);
  expect(translated).toBe(0);
});
