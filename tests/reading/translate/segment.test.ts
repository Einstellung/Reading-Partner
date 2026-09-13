// What gets a translation and what is left alone.
// Run: bash scripts/t.sh tests/reading/translate/segment.test.ts

import { expect, test } from "bun:test";
import { hasTranslations, segmentDocument } from "../../../src/reading/translate/segment";
import { placeholder } from "../../../src/reading/translate/mask";

const BODY = `<header class="rp-header">
  <h1 class="rp-title" id="rp-h1">How a page becomes a book</h1>
  <p class="rp-byline">A Writer</p>
  <p class="rp-published"><time datetime="2026-09-12">2026-09-12</time></p>
  <p class="rp-source">https://example.com/posts/one</p>
</header>
<p>A paragraph with <em>emphasis</em>, a <a href="#x">link</a> and <code>parse()</code> in it.</p>
<h2 id="rp-h2">The first section</h2>
<ul>
  <li>First item<ul><li>Nested item</li></ul></li>
  <li>Second item</li>
</ul>
<pre><code>const x = 1;</code></pre>
<p>Inline maths <math><mi>x</mi></math> in a sentence.</p>
<math display="block"><mi>E</mi></math>
<table><tr><td>A cell of text</td></tr></table>
<figure><img src="../images/a.png" alt="a"/><figcaption>Figure 1</figcaption></figure>
<blockquote><p>A quoted line.</p></blockquote>
<p><math><mi>y</mi></math></p>`;

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<html><body>${html}</body></html>`, "text/html");
}

const blocks = segmentDocument(parse(BODY));

test("the blocks are the leaf blocks, in document order, numbered from one", () => {
  expect(blocks.map((b) => b.id)).toEqual(["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"]);
  expect(blocks.map((b) => b.element.localName)).toEqual([
    "h1", "p", "h2", "li", "li", "li", "p", "p",
  ]);
  expect(blocks[blocks.length - 1].text).toBe("A quoted line.");
});

test("the header's metadata lines are not translated, its title is", () => {
  const texts = blocks.map((b) => b.text);
  expect(texts[0]).toBe("How a page becomes a book");
  expect(texts.some((t) => t.includes("A Writer"))).toBe(false);
  expect(texts.some((t) => t.includes("example.com"))).toBe(false);
  expect(texts.some((t) => t.includes("2026-09-12"))).toBe(false);
});

test("a <pre>, a table, a figure and a display formula are not blocks", () => {
  const texts = blocks.map((b) => b.text).join("\n");
  expect(texts).not.toContain("const x = 1");
  expect(texts).not.toContain("A cell of text");
  expect(texts).not.toContain("Figure 1");
  // The <p> holding nothing but a formula has no sentence to translate.
  expect(blocks.some((b) => b.element.localName === "p" && b.text === placeholder(1))).toBe(false);
});

test("inline markup stays in the text, inline code and maths leave a placeholder", () => {
  const paragraph = blocks[1];
  expect(paragraph.text).toBe(
    `A paragraph with emphasis, a link and ${placeholder(1)} in it.`,
  );
  expect(paragraph.masks).toHaveLength(1);
  expect(paragraph.masks[0].node.localName).toBe("code");

  const maths = blocks.find((b) => b.text.startsWith("Inline maths"));
  expect(maths?.text).toBe(`Inline maths ${placeholder(1)} in a sentence.`);
  expect(maths?.masks[0].node.localName).toBe("math");
});

test("a list item sends its own line and takes its translation inside itself", () => {
  const items = blocks.filter((b) => b.element.localName === "li");
  expect(items.map((b) => b.text)).toEqual(["First item", "Nested item", "Second item"]);
  expect(items.every((b) => b.mode === "nested")).toBe(true);
  expect(blocks[0].mode).toBe("sibling");
});

test("a document that already has translations offers none, and says so", () => {
  const doc = parse(`<p>Original.</p><p class="rp-zh" lang="zh">译文。</p>`);
  expect(hasTranslations(doc)).toBe(true);
  expect(segmentDocument(doc).map((b) => b.text)).toEqual(["Original."]);
  expect(hasTranslations(parse(BODY))).toBe(false);
});
