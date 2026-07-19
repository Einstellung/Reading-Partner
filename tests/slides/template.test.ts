// Unit tests for deck assembly (src/slides/template.ts): placeholders replaced,
// slides wrapped, output self-contained. Run: bun test.

import { expect, test } from "bun:test";
import { assembleDeck, slugify } from "../../src/slides/template";

test("slugify makes a filename-safe stem", () => {
  expect(slugify("My Great Talk!")).toBe("my-great-talk");
  expect(slugify("   ")).toBe("talk");
  expect(slugify("a".repeat(80)).length).toBeLessThanOrEqual(60);
});

test("assembleDeck injects an asset into the placeholder", () => {
  const html = assembleDeck({
    title: "T",
    slides: [
      {
        kind: "content",
        fragment: '<div class="figwrap"><!--illustration--></div>',
        asset: "data:image/png;base64,AAA",
      },
    ],
  });
  expect(html).toContain('<img src="data:image/png;base64,AAA" alt="">');
  expect(html).not.toContain("<!--illustration-->");
});

test("assembleDeck removes a placeholder and its empty figwrap when no asset", () => {
  const html = assembleDeck({
    title: "T",
    slides: [{ kind: "content", fragment: '<div class="figwrap"><!--figure--></div>', asset: null }],
  });
  expect(html).not.toContain("<!--figure-->");
  expect(html).not.toContain('<div class="figwrap"></div>');
});

test("assembleDeck wraps slides, sets the counter total, and marks the title slide", () => {
  const html = assembleDeck({
    title: "Talk",
    slides: [
      { kind: "title", fragment: "<h1 class=\"deck-title\">Talk</h1>", asset: null },
      { kind: "content", fragment: "<h2>Body</h2>", asset: null },
    ],
  });
  expect(html).toContain('<section class="slide title-slide">');
  expect(html).toContain('<section class="slide">');
  expect(html).toContain("1 / 2");
  expect(html).toContain("<title>Talk</title>");
});

test("the assembled deck is self-contained: no external URLs", () => {
  const html = assembleDeck({
    title: "T",
    slides: [
      { kind: "content", fragment: '<ul class="pts"><li>Point<span class="pg">p.1</span></li></ul>', asset: "data:image/png;base64,ZZZ" },
    ],
  });
  // No http(s) references at all — only inline CSS/JS and data: assets.
  expect(/https?:\/\//.test(html)).toBe(false);
});

test("assembleDeck escapes the title", () => {
  const html = assembleDeck({ title: "A & B <x>", slides: [{ kind: "title", fragment: "", asset: null }] });
  expect(html).toContain("<title>A &amp; B &lt;x&gt;</title>");
});
