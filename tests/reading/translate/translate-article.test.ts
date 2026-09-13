// An article EPUB in, a bilingual EPUB out, through the whole core with a fake
// model. Run: bash scripts/t.sh tests/reading/translate/translate-article.test.ts

import { expect, test } from "bun:test";
import { buildArticleEpub } from "../../../src/reading/epub/build-article";
import { parseEpub } from "../../../src/reading/epub/parse";
import { openZip } from "../../../src/reading/epub/zip";
import { characterRuler, paginate } from "../../../src/reading/epub/paginate";
import { segmentDocument } from "../../../src/reading/translate/segment";
import {
  translateArticleEpub,
  TranslateError,
} from "../../../src/reading/translate/translate-article";
import type {
  TranslateBatchFn,
  TranslateBatchRequest,
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

// A translator that answers every block and settles one term, so the output can
// be told apart from the original character by character.
function fakeTranslator(seen: TranslateBatchRequest[] = []): TranslateBatchFn {
  return async (request) => {
    seen.push(request);
    return {
      blocks: request.blocks.map((b) => ({ id: b.id, text: `[zh]${b.text}` })),
      terms: [{ source: "fox", zh: "狐狸" }],
    };
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
  const out = await translateArticleEpub(original, { translateBatch: fakeTranslator() });
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
  const out = await translateArticleEpub(original, { translateBatch: fakeTranslator() });
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

test("the batches share a glossary, and the progress is reported", async () => {
  const seen: TranslateBatchRequest[] = [];
  const original = await buildArticleEpub(INPUT);
  const steps: Array<[number, number]> = [];
  const out = await translateArticleEpub(original, {
    translateBatch: fakeTranslator(seen),
    onProgress: (done, total) => steps.push([done, total]),
    // Small enough that this short article takes several calls.
    limits: { target: 30, max: 60 },
  });
  expect(seen.length).toBeGreaterThan(1);
  expect(seen[0].glossary).toEqual([]);
  expect(seen[1].glossary).toEqual([{ source: "fox", zh: "狐狸" }]);
  expect(out.glossary).toEqual([{ source: "fox", zh: "狐狸" }]);
  expect(steps[steps.length - 1][0]).toBe(steps[steps.length - 1][1]);
  expect(seen.every((r) => r.title === INPUT.title)).toBe(true);
});

test("translating the translation is refused", async () => {
  const { bilingual } = await translated();
  await expect(
    translateArticleEpub(bilingual, { translateBatch: fakeTranslator() }),
  ).rejects.toThrow(TranslateError);
});

test("a batch that comes back mis-shaped is retried once, then fails the run", async () => {
  const original = await buildArticleEpub(INPUT);
  let calls = 0;
  const flaky: TranslateBatchFn = async (request) => {
    calls++;
    if (calls === 1) throw new (await import("../../../src/reading/translate/prompt")).BatchShapeError("short");
    return { blocks: request.blocks.map((b) => ({ id: b.id, text: "译" })), terms: [] };
  };
  const out = await translateArticleEpub(original, { translateBatch: flaky });
  expect(calls).toBe(2);
  expect(out.blocks).toBeGreaterThan(0);

  let always = 0;
  const broken: TranslateBatchFn = async () => {
    always++;
    throw new (await import("../../../src/reading/translate/prompt")).BatchShapeError("short");
  };
  await expect(translateArticleEpub(original, { translateBatch: broken })).rejects.toThrow(
    TranslateError,
  );
  expect(always).toBe(2);
});
